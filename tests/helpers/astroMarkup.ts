import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A markup nesting rule the HTML parser silently "fixes" instead of honouring.
 *
 * The browser never renders what the author wrote in these cases: it closes the
 * outer element early and re-parents the inner one. The visible control then
 * sits outside the element that carries the click listener, ids and attributes
 * land on the wrong node, and the page looks subtly wrong — all without a build
 * error, a type error or a runtime exception. `astro check` does not model HTML
 * content rules, so nothing else in this repo catches it.
 */
export interface MarkupViolation {
    file: string;
    line: number;
    /** The tag that may not appear here, e.g. `button`. */
    tag: string;
    /** The already-open ancestor that forbids it, e.g. `button`. */
    ancestor: string;
    ancestorLine: number;
    rule: string;
}

/**
 * Interactive content, in the HTML content-model sense. `<button>` and `<a>`
 * may not contain any of it; the parser closes them early when they do.
 */
const INTERACTIVE = new Set(['button', 'a', 'select', 'textarea', 'input', 'label']);

/**
 * Which ancestors forbid which descendants. A `<label>` wrapping its own
 * `<input>` is the idiomatic pattern and stays legal — only a second `<label>`
 * inside it is not.
 */
const FORBIDS: Record<string, (tag: string) => boolean> = {
    button: (tag) => INTERACTIVE.has(tag),
    a: (tag) => INTERACTIVE.has(tag),
    label: (tag) => tag === 'label',
    form: (tag) => tag === 'form',
};

/** Never have a closing tag, so they must not be pushed onto the stack. */
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Clerk's unstyled buttons render a `<button>` of their own and attach the
 * click listener to it — unless `asChild` is passed, which makes them hand the
 * listener to the first tag of their slot instead. Without `asChild` they are
 * an interactive ancestor, and a styled `<button>` inside them is the exact
 * nesting that broke sign-out across the marketplace.
 */
const CLERK_BUTTON_COMPONENTS = new Set([
    'SignInButton', 'SignUpButton', 'SignOutButton', 'CheckoutButton',
    'PlanDetailsButton', 'SubscriptionDetailsButton',
]);

/**
 * Local names bound to Clerk's button components, import aliases included:
 * `import { SignOutButton as ClerkSignOutButton }` is how this repo imports
 * them, so matching the exported name alone would miss every real usage.
 */
export function collectClerkButtonNames(source: string): Set<string> {
    const names = new Set<string>();
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@clerk\/astro\/components['"]/g)) {
        for (const clause of match[1].split(',')) {
            const [imported, local] = clause.split(/\s+as\s+/).map((part) => part.trim());
            if (CLERK_BUTTON_COMPONENTS.has(imported)) names.add(local || imported);
        }
    }
    return names;
}

interface Tag {
    name: string;
    line: number;
    attrs: string;
    closing: boolean;
    selfClosing: boolean;
}

/**
 * Attribute-aware tag lexer: quoted attribute values may contain `>`, so a
 * naive `<[^>]+>` would end tags in the wrong place and corrupt the stack.
 */
const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

function stripNonMarkup(source: string): string {
    let out = source;
    // Frontmatter: the leading `---` fenced block.
    out = out.replace(/^---\r?\n[\s\S]*?\r?\n---/, (m) => m.replace(/[^\n]/g, ' '));
    // Script/style bodies hold JS and CSS, not markup.
    out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));
    // HTML and JSX-expression comments.
    out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '));
    return out;
}

function lexTags(source: string): Tag[] {
    const tags: Tag[] = [];
    const text = stripNonMarkup(source);
    for (const match of text.matchAll(TAG)) {
        tags.push({
            closing: match[1] === '/',
            name: match[2],
            attrs: match[3] ?? '',
            selfClosing: match[4] === '/',
            line: text.slice(0, match.index).split('\n').length,
        });
    }
    return tags;
}

function hasAttr(attrs: string, name: string): boolean {
    return new RegExp(`(^|\\s)${name}(\\s|=|$)`).test(attrs);
}

/**
 * What this tag acts as once rendered: an interactive element in its own
 * right, or transparent markup. Components are only classified when the answer
 * is unambiguous — an unknown component is assumed transparent so the scan
 * stays free of guesses.
 */
function interactiveAs(
    tag: Tag,
    componentRoots: Map<string, string>,
    clerkButtons: Set<string>,
): string | null {
    const lower = tag.name.toLowerCase();
    if (INTERACTIVE.has(lower) || lower === 'form') {
        // A bare `<a>` without href is not a link and nests freely.
        if (lower === 'a' && !hasAttr(tag.attrs, 'href')) return null;
        return lower;
    }
    if (clerkButtons.has(tag.name)) {
        return hasAttr(tag.attrs, 'asChild') ? null : 'button';
    }
    return componentRoots.get(tag.name) ?? null;
}

/**
 * Local components whose template is a single interactive element, so using
 * one inside a `<button>` or a link nests two interactive elements just as
 * surely as writing the tag inline.
 */
export function collectComponentRoots(files: string[]): Map<string, string> {
    const roots = new Map<string, string>();
    for (const file of files) {
        const tags = lexTags(readFileSync(file, 'utf8'));
        const depth: string[] = [];
        const topLevel: string[] = [];
        for (const tag of tags) {
            if (tag.closing) {
                depth.pop();
                continue;
            }
            if (depth.length === 0) topLevel.push(tag.name.toLowerCase());
            if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name.toLowerCase())) depth.push(tag.name);
        }
        // Only when every top-level element is the same interactive tag: a
        // component that sometimes renders a <div> cannot be judged here.
        const unique = new Set(topLevel);
        if (unique.size === 1) {
            const [only] = unique;
            if (INTERACTIVE.has(only) && only !== 'input') {
                roots.set(file.split('/').pop()!.replace(/\.astro$/, ''), only);
            }
        }
    }
    return roots;
}

/** Reports every interactive element nested inside another one. */
export function scanTemplate(
    file: string,
    source: string,
    componentRoots: Map<string, string> = new Map(),
): MarkupViolation[] {
    const violations: MarkupViolation[] = [];
    const open: { name: string; line: number; interactiveAs: string | null }[] = [];
    const clerkButtons = collectClerkButtonNames(source);

    for (const tag of lexTags(source)) {
        const lower = tag.name.toLowerCase();
        if (tag.closing) {
            // Pop to the matching open tag. Astro templates hold conditional
            // branches, so tolerate an unbalanced stack rather than drift.
            const index = open.map((t) => t.name.toLowerCase()).lastIndexOf(lower);
            if (index !== -1) open.splice(index);
            continue;
        }

        const acts = interactiveAs(tag, componentRoots, clerkButtons);
        if (acts) {
            const ancestor = [...open].reverse().find(
                (t) => t.interactiveAs && FORBIDS[t.interactiveAs]?.(acts),
            );
            if (ancestor) {
                violations.push({
                    file,
                    line: tag.line,
                    tag: acts === lower ? lower : `${tag.name} (renders <${acts}>)`,
                    ancestor: ancestor.interactiveAs!,
                    ancestorLine: ancestor.line,
                    rule: 'interactive-inside-interactive',
                });
            }
        }

        if (!tag.selfClosing && !VOID_ELEMENTS.has(lower)) {
            open.push({ name: tag.name, line: tag.line, interactiveAs: acts });
        }
    }

    return violations;
}

/** Every `.astro` file under `dir`, as paths relative to the repo root. */
export function collectAstroFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? collectAstroFiles(path) : path.endsWith('.astro') ? [path] : [];
    });
}

export function formatViolation(v: MarkupViolation, root: string): string {
    return `${relative(root, v.file)}:${v.line} — <${v.tag}> inside <${v.ancestor}> opened at line ${v.ancestorLine}`;
}

/**
 * A DOM lookup in a client script that no source file can satisfy.
 *
 * `document.getElementById('x')` returning null, or `querySelectorAll('[x]')`
 * matching nothing, is the quietest failure in a server-rendered app: no build
 * error, no type error, and — for the `querySelectorAll` form — not even a
 * runtime exception. The handler simply never runs, which is what "the button
 * does nothing" looks like from the outside.
 */
export interface DeadTarget {
    file: string;
    line: number;
    /** `#id` or `[data-attribute]`, as written in the script. */
    selector: string;
}

/** `getElementById('x')` and `querySelector('[data-x]')` lookups. */
const ID_LOOKUP = /getElementById\(\s*['"`]([\w-]+)['"`]/g;
const ATTR_LOOKUP = /querySelector(?:All)?\(\s*['"`]\[([\w-]+)\]['"`]/g;

/**
 * Ids as rendered, including interpolated ones: a panel that emits
 * ``id={`${idPrefix}-weight-input`}`` really does produce
 * `central-weight-input` for a caller passing "central", so the shape has to
 * match as a pattern rather than as a literal.
 */
const ID_RENDER = /\bid=(?:["']([^"']+)["']|\{`([^`]+)`\}|\{["']([^"']+)["']\})/g;
const ID_IN_STRING = /\bid=\\?["']([^"'\\]*\$\{[^}]+\}[^"'\\]*|[\w-]+)\\?["']/g;

function shapeToRegExp(shape: string): RegExp {
    const escaped = shape
        .split(/\$\{[^}]*\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\w-]*');
    return new RegExp(`^${escaped}$`);
}

/**
 * Every id a source file can render, as literal strings and as patterns.
 * Scripts that build markup with template strings count too — the cart and the
 * seller forms both create rows that way.
 */
export function collectRenderedIds(sources: string[]): RegExp[] {
    const shapes = new Set<string>();
    for (const source of sources) {
        for (const re of [ID_RENDER, ID_IN_STRING]) {
            for (const match of source.matchAll(re)) {
                const shape = match[1] ?? match[2] ?? match[3];
                if (shape) shapes.add(shape.trim());
            }
        }
    }
    return [...shapes].map(shapeToRegExp);
}

/** Every attribute name that appears on a rendered tag. */
export function collectRenderedAttributes(sources: string[]): Set<string> {
    const names = new Set<string>();
    for (const source of sources) {
        // Strip lookups first so a selector never counts as its own target.
        const markup = source.replace(/querySelector\w*\([^)]*\)/g, '');
        for (const match of markup.matchAll(/(?:^|[\s({])(data-[\w-]+)/g)) {
            names.add(match[1]);
        }
    }
    return names;
}

/**
 * DOM lookups in `files` that nothing in `sources` can ever satisfy.
 *
 * A component may legitimately drive markup rendered by a sibling or by its
 * page, so a target only counts as dead when it is absent from every source
 * file — the case that is always a typo, a rename, or deleted markup.
 */
export function findDeadTargets(
    files: { file: string; source: string }[],
    sources: string[],
): DeadTarget[] {
    const ids = collectRenderedIds(sources);
    const attributes = collectRenderedAttributes(sources);
    const dead: DeadTarget[] = [];

    for (const { file, source } of files) {
        const lineOf = (index: number) => source.slice(0, index).split('\n').length;

        for (const match of source.matchAll(ID_LOOKUP)) {
            const id = match[1];
            if (!ids.some((shape) => shape.test(id))) {
                dead.push({ file, line: lineOf(match.index), selector: `#${id}` });
            }
        }
        for (const match of source.matchAll(ATTR_LOOKUP)) {
            const attribute = match[1];
            if (!attributes.has(attribute)) {
                dead.push({ file, line: lineOf(match.index), selector: `[${attribute}]` });
            }
        }
    }

    return dead;
}
