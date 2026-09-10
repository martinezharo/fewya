/**
 * The Clerk publishable key is a *build-time* input, not a runtime one.
 *
 * Astro inlines `PUBLIC_CLERK_PUBLISHABLE_KEY` into both the client bundle and
 * the server bundle, so the value baked in is whatever the machine running the
 * build happened to have. A Worker secret cannot replace it afterwards: with no
 * key in the bundle, Clerk's middleware throws on the first request and every
 * page answers with a redirect to itself, which takes the whole site down —
 * catalog included, signed out or not.
 *
 * That is a build the deploy must never produce, so the check runs at build
 * time and fails loudly instead.
 */

const KEY = 'PUBLIC_CLERK_PUBLISHABLE_KEY';

export interface BuildKeyProblem {
    level: 'error' | 'warning';
    message: string;
}

const MISSING = [
    `${KEY} is missing, and the build would ship without it.`,
    '',
    'Astro inlines this key into the bundle, so a Worker secret set afterwards',
    'does not replace it: Clerk throws on every request and the site answers a',
    'redirect loop.',
    '',
    'Locally:  bun --env-file=.env.clerk-production run build',
    `In Cloudflare Workers Builds: add ${KEY} as a build variable`,
    '(Settings → Builds → Variables and Secrets). It is a *publishable* key —',
    'it is served to every visitor in the page bundle — so it is not a secret.',
].join('\n');

const DEVELOPMENT_KEY = [
    `${KEY} is a development key (pk_test_…).`,
    'The build will work, but it authenticates against the Clerk *development*',
    'instance: production Convex trusts the production issuer and will reject',
    'its tokens. Use the production key for anything deployed to fewya.com.',
].join('\n');

/**
 * Checks a publishable key as it would be inlined, without touching the
 * environment, so the rule can be tested rather than only observed in CI.
 */
export function checkClerkPublishableKey(value: string | undefined): BuildKeyProblem | null {
    const key = value?.trim();
    if (!key) return { level: 'error', message: MISSING };
    if (key.startsWith('pk_test_')) return { level: 'warning', message: DEVELOPMENT_KEY };
    return null;
}
