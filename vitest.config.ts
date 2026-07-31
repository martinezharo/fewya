import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            'astro:env/server': path.resolve(__dirname, 'tests/mocks/astro-env-server.ts'),
            'astro:middleware': path.resolve(__dirname, 'tests/mocks/astro-middleware.ts'),
            'cloudflare:workers': path.resolve(__dirname, 'tests/mocks/cloudflare-workers.ts'),
        },
    },
    test: {
        environment: 'happy-dom',
        globals: true,
        // The RLS suite needs a live Postgres and runs as its own project;
        // see vitest.rls.config.ts and tests/rls/README.md.
        exclude: ['node_modules/**', 'tests/rls/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'tests/',
                '**/*.d.ts',
                '**/*.config.*',
                'src/pages/**',
                'src/layouts/**',
                'src/components/**',
                'src/styles/**',
                'src/types/**',
            ],
        },
    },
});
