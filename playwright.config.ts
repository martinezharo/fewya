import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4321',
        storageState: process.env.E2E_AUTH_STATE || undefined,
        trace: 'retain-on-failure',
        ...devices['Desktop Chrome'],
    },
});
