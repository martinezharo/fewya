/**
 * Astro's `defineMiddleware` is a typing helper: at runtime it returns the
 * function unchanged. Reproducing that is what lets `src/middleware.ts` be
 * imported and called directly by a test.
 */
export function defineMiddleware<T>(handler: T): T {
    return handler;
}
