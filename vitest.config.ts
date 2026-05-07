import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            'astro:env/server': path.resolve(__dirname, 'tests/mocks/astro-env-server.ts'),
        },
    },
    test: {
        environment: 'happy-dom',
        globals: true,
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
                'src/middleware.ts',
                'src/styles/**',
                'src/types/**',
            ],
        },
    },
});
