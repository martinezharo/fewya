/**
 * Stand-in for the `cloudflare:workers` module, which only exists inside the
 * Workers runtime.
 *
 * `env` is a live object rather than a frozen snapshot so a test can add or
 * remove a binding — the missing-binding case is the one worth asserting — and
 * the middleware will see the change on its next call.
 */
export const env: Record<string, unknown> = {};
