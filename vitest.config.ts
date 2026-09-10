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
        // tests/convex/* run the real Convex functions and set their own
        // `@vitest-environment edge-runtime` docblock; everything else is DOM.
        exclude: ['node_modules/**', 'tests/e2e/**'],
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
