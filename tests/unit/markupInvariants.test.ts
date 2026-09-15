import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    collectAstroFiles,
    collectComponentRoots,
    componentRootsFor,
    findDeadTargets,
    formatViolation,
    scanTemplate,
} from '../helpers/astroMarkup';

const ROOT = join(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : /\.(astro|ts)$/.test(path) ? [path] : [];
    });
}

const templates = collectAstroFiles(SRC).map((file) => ({ file, source: readFileSync(file, 'utf8') }));
// Client scripts live in `.astro` templates and in `.ts` modules alike, and a
// lookup is just as dead in either, so both are scanned.
const sourceEntries = sourceFiles(SRC).map((file) => ({ file, source: readFileSync(file, 'utf8') }));
const allSources = sourceEntries.map(({ source }) => source);

/**
 * Both checks below target one failure mode: markup that compiles, type-checks
 * and deploys, yet produces a control the user cannot operate. The sign-out
 * button was exactly that — a `<button>` nested in Clerk's own `<button>`, so
 * the parser moved the visible control out of the element holding the click
 * listener. `astro check` does not model HTML content rules and no test
 * rendered a component, so nothing caught it before it shipped.
 */
describe('markup invariants', () => {
    it('never nests a control inside another control', () => {
        const roots = collectComponentRoots(templates.map((t) => t.file));
        const violations = templates.flatMap(({ file, source }) =>
            scanTemplate(file, source, componentRootsFor(file, source, roots)),
        );

        expect(violations.map((v) => formatViolation(v, ROOT))).toEqual([]);
    });

    it('never queries the DOM for something no source file renders', () => {
        const dead = findDeadTargets(sourceEntries, allSources);

        expect(dead.map((d) => `${d.file.replace(`${ROOT}/`, '')}:${d.line} ${d.selector}`)).toEqual([]);
    });
});

/**
 * A detector that cannot fail is worse than no detector, so the rules are
 * exercised against the shapes they exist to catch — including the sign-out
 * regression itself — and against the valid patterns they must leave alone.
 */
describe('markup invariants: the rules themselves', () => {
    const scan = (markup: string, roots = new Map<string, string>()) =>
        scanTemplate('probe.astro', markup, roots);

    const clerkImport = "---\nimport { SignOutButton } from '@clerk/astro/components';\n---\n";
    const aliasedImport = "---\nimport { SignOutButton as ClerkSignOutButton } from '@clerk/astro/components';\n---\n";

    it('catches the sign-out regression: a styled button inside Clerk\'s own button', () => {
        const violations = scan(`${clerkImport}
            <SignOutButton redirectUrl="/">
                <button type="button" class="w-full">Sign out</button>
            </SignOutButton>
        `);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ tag: 'button', ancestor: 'button' });
    });

    it('sees through the import alias the repo actually uses', () => {
        expect(scan(`${aliasedImport}
            <ClerkSignOutButton redirectUrl="/">
                <button type="button">Sign out</button>
            </ClerkSignOutButton>
        `)).toHaveLength(1);
    });

    it('accepts the same markup once Clerk is told to use our button', () => {
        expect(scan(`${aliasedImport}
            <ClerkSignOutButton asChild redirectUrl="/">
                <button type="button" class="w-full">Sign out</button>
            </ClerkSignOutButton>
        `)).toEqual([]);
    });

    it('ignores a same-named component that is not Clerk\'s', () => {
        // The repo has its own settings SignOutButton; it renders a card, not
        // a button, and must not be mistaken for the Clerk one.
        expect(scan(`---
import SignOutButton from '../components/settings/SignOutButton.astro';
---
            <SignOutButton />
            <button type="button">x</button>
        `)).toEqual([]);
    });

    it('catches a link inside a link and a button inside a link', () => {
        expect(scan('<a href="/a"><a href="/b">x</a></a>')).toHaveLength(1);
        expect(scan('<a href="/a"><button type="button">x</button></a>')).toHaveLength(1);
    });

    it('catches a local component whose root element is itself a control', () => {
        const roots = new Map([['WishlistButton', 'button']]);

        expect(scan('<a href="/p"><WishlistButton productId="1" /></a>', roots)).toHaveLength(1);
        expect(scan('<article><WishlistButton productId="1" /></article>', roots)).toEqual([]);
    });

    it('records an input-only component as a control, keyed by its path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'markup-'));
        const file = join(dir, 'QuantityInput.astro');
        writeFileSync(file, '<input type="number" class="qty" />\n');

        expect([...collectComponentRoots([file])]).toEqual([[file, 'input']]);
    });

    it('follows a default import to the component it actually names', () => {
        const rootsByPath = new Map([['/app/src/components/WishlistButton.astro', 'button']]);
        const source = "---\nimport FavoriteControl from '../components/WishlistButton.astro';\n---\n";
        const roots = componentRootsFor('/app/src/pages/product.astro', source, rootsByPath);

        expect(scan(`${source}<a href="/p"><FavoriteControl productId="1" /></a>`, roots)).toHaveLength(1);
    });

    it('treats a component that renders a bare input as the control it is', () => {
        const roots = new Map([['QuantityInput', 'input']]);

        expect(scan('<button type="button"><QuantityInput /></button>', roots)).toHaveLength(1);
        // A label may hold its own control, whoever renders it.
        expect(scan('<label><QuantityInput /></label>', roots)).toEqual([]);
    });

    it('leaves valid markup alone', () => {
        // A label wrapping its own control is the idiomatic pattern.
        expect(scan('<label><input type="radio" /><span>Full</span></label>')).toEqual([]);
        // An anchor without href is not a link.
        expect(scan('<a><button type="button">x</button></a>')).toEqual([]);
        // Controls side by side, and a link inside a card that is not a link.
        expect(scan('<div><button type="button">a</button><a href="/b">b</a></div>')).toEqual([]);
        // A `>` inside an attribute value must not end the tag early.
        expect(scan('<div class="has-[input:checked]:border"><button type="button">x</button></div>')).toEqual([]);
    });

    it('catches a script that queries markup nobody renders', () => {
        const dead = findDeadTargets(
            [{ file: 'probe.astro', source: "<div data-panel></div><script>document.getElementById('gone');document.querySelector('[data-pannel]');</script>" }],
            ['<div data-panel></div>'],
        );

        expect(dead.map((d) => d.selector)).toEqual(['#gone', '[data-pannel]']);
    });

    it('accepts an attribute a script creates at runtime', () => {
        const dead = findDeadTargets(
            [{ file: 'busy.ts', source: "el.querySelector('[data-busy-spinner]');" }],
            ["spinner.setAttribute('data-busy-spinner', '');"],
        );

        expect(dead).toEqual([]);
    });

    it('accepts a target rendered by another file, or built from an interpolated id', () => {
        const dead = findDeadTargets(
            [{ file: 'probe.astro', source: "document.getElementById('central-weight-input');document.querySelector('[data-gallery]');" }],
            ['<input id={`${idPrefix}-weight-input`} />', '<div data-gallery></div>'],
        );

        expect(dead).toEqual([]);
    });
});
