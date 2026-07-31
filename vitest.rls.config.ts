import { defineConfig } from 'vitest/config';

/**
 * RLS tests run against a real Postgres, so they are a separate project from
 * the unit suite: they are slower, they need a database, and `bun run test`
 * (which the pre-push hook runs) must stay runnable with nothing installed.
 *
 * See tests/rls/README.md for how to point them at a database.
 */
export default defineConfig({
    test: {
        include: ['tests/rls/**/*.test.ts'],
        environment: 'node',
        globals: true,
        // One connection, one schema load, many assertions.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 120_000,
    },
});
