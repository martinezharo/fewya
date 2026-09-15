import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');

function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}

/**
 * Clerk's <SignOutButton> renders its own <button> and attaches the sign-out
 * listener to it. Without `asChild`, a styled <button> in the slot becomes a
 * nested button: the parser closes Clerk's button early, the visible control
 * ends up outside the listener's element, and clicking it silently does
 * nothing. Neither astro check nor any runtime test catches that, so guard the
 * single wiring point — and the absence of second ones — here.
 */
describe('sign-out wiring', () => {
    const files = walk(SRC).filter((f) => f.endsWith('.astro'));

    it('the shared action passes asChild to Clerk', () => {
        const source = readFileSync(join(SRC, 'components/settings/SignOutAction.astro'), 'utf8');
        expect(source).toMatch(/<ClerkSignOutButton[^>]*\basChild\b/);
    });

    it('no other component imports Clerk sign-out directly', () => {
        const direct = files.filter(
            (f) =>
                !f.endsWith('SignOutAction.astro') &&
                /SignOutButton[^\n]*from '@clerk\/astro\/components'/.test(readFileSync(f, 'utf8')),
        );
        expect(direct).toEqual([]);
    });
});
