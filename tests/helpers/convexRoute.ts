import { vi, type Mock } from 'vitest';
import type { AuthUser } from '../../src/lib/core/auth';

/**
 * Stand-in for the Convex-backed request auth used by every API route.
 *
 * Routes no longer talk to a database directly: they resolve the caller with
 * `getRequestUser` and act through a Convex client that carries that caller's
 * identity. Tests therefore assert two things — which Convex function a route
 * calls, and that it refuses to call anything when the caller is anonymous.
 */
export interface ConvexRouteMock {
    query: Mock;
    mutation: Mock;
    /** The identity the route sees. `null` makes the request anonymous. */
    user: AuthUser | null;
    /** Module object for `vi.mock('src/lib/core/auth', ...)`. */
    authModule(): Record<string, unknown>;
    reset(user?: AuthUser | null): void;
}

const DEFAULT_USER: AuthUser = { id: 'user-1', email: 'buyer@fewya.com' };

export function createConvexRouteMock(): ConvexRouteMock {
    const state: ConvexRouteMock = {
        query: vi.fn(),
        mutation: vi.fn(),
        user: DEFAULT_USER,
        authModule() {
            return {
                createRequestConvexClient: () =>
                    (state.user ? { query: state.query, mutation: state.mutation } : null),
                getRequestUser: () => state.user,
                getRequestConvexToken: () => (state.user ? 'convex-token' : null),
                normalizeAuthRedirectPath: (path?: string | null) =>
                    (!path || !path.startsWith('/') || path.startsWith('//') ? '/' : path),
                assertSameOrigin: () => true,
            };
        },
        reset(user: AuthUser | null = DEFAULT_USER) {
            state.query.mockReset();
            state.mutation.mockReset();
            state.user = user;
        },
    };
    return state;
}
