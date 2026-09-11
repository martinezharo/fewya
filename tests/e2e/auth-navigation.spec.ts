import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-US' });
test.skip(!process.env.E2E_BASE_URL, 'Set E2E_BASE_URL to a running test build with Clerk configured.');

test('keeps the destination while switching between sign-in and sign-up', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto('/login?redirect_to=%2Fcart%3Fcheckout%3D1');
    expect(response?.headers()['cache-control']).toBe('private, no-store');

    await page.getByRole('link', { name: 'Sign up', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/sign-up'
        && url.searchParams.get('redirect_to') === '/cart?checkout=1');
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/login'
        && url.searchParams.get('redirect_to') === '/cart?checkout=1');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(errors).toEqual([]);
});

test('retires cached session pages when the new service worker activates', async ({ page }) => {
    // A static document gives us this origin without starting the app's worker.
    await page.goto('/favicon.svg');
    await page.evaluate(async () => {
        const pages = await caches.open('pages');
        await pages.put('/login', new Response('Old sign-in screen'));
        const images = await caches.open('images');
        await images.put('/cached-image.svg', new Response('<svg/>'));
    });

    await page.goto('/login');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect.poll(() => page.evaluate(() => caches.has('pages'))).toBe(false);
    expect(await page.evaluate(() => caches.has('images'))).toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(await page.evaluate(() => caches.has('pages'))).toBe(false);
});
