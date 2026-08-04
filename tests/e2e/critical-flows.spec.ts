import { expect, test } from '@playwright/test';

const configured = Boolean(process.env.E2E_BASE_URL && process.env.E2E_AUTH_STATE);

test.describe('critical commerce flows', () => {
test.skip(!configured, 'Set E2E_BASE_URL and E2E_AUTH_STATE; see tests/e2e/README.md.');

test('checkout sends the selected delivery method and reaches Stripe', async ({ page }) => {
    const cart = [{
        productId: 'product-e2e', variantId: 'variant-e2e', quantity: 2,
        title: 'E2E product', image: '/placeholder.svg', price: 12.5, stock: 5,
        variantName: null, shopId: 'shop-e2e', shopName: 'E2E shop',
        shopSlug: 'e2e-shop', productSlug: 'e2e-product', shippingCost: 0,
    }];
    await page.addInitScript((items) => localStorage.setItem('fewya_cart', JSON.stringify(items)), cart);

    await page.route('**/api/cart/freshness', (route) => route.fulfill({
        json: { items: [{ variantId: 'variant-e2e', stock: 5, price: 12.5, shippingCost: 0, isAvailable: true }] },
    }));
    await page.route('**/api/me/profile-status', (route) => route.fulfill({ json: { complete: true } }));
    await page.route('**/api/cart/delivery-options', (route) => route.fulfill({
        json: { homeAvailable: true, pickupAvailable: true, pickupCarriers: ['correos'] },
    }));

    let checkoutBody: unknown;
    await page.route('**/api/cart/checkout', async (route) => {
        checkoutBody = route.request().postDataJSON();
        await route.fulfill({ json: { checkoutUrl: 'https://checkout.stripe.test/e2e-session' } });
    });
    await page.route('https://checkout.stripe.test/**', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<title>Stripe test checkout</title><h1>Stripe test checkout</h1>',
    }));

    await page.goto('/cart');
    await expect(page.locator('#cart-content')).toBeVisible();
    await expect(page.getByText('E2E product')).toBeVisible();

    await page.locator('#checkout-btn-desktop').click();
    await expect(page.locator('#delivery-modal')).toBeVisible();
    await page.locator('#delivery-option-home').click();
    await page.locator('#delivery-continue-btn').click();

    await expect(page).toHaveURL('https://checkout.stripe.test/e2e-session');
    expect(checkoutBody).toEqual({
        items: [{ variantId: 'variant-e2e', quantity: 2 }],
        delivery: { type: 'home' },
    });
});

test('seller onboarding creates the shop and advances to Stripe setup', async ({ page }) => {
    let submitted: Record<string, string> = {};
    await page.route('**/sell/onboarding', async (route) => {
        if (route.request().method() === 'GET') return route.continue();
        const body = await route.request().postDataBuffer();
        const contentType = route.request().headers()['content-type'] ?? '';
        expect(contentType).toContain('multipart/form-data');
        const boundary = contentType.match(/boundary=(.+)$/)?.[1];
        expect(boundary).toBeTruthy();
        const text = body?.toString('utf8') ?? '';
        for (const match of text.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)) submitted[match[1]] = match[2];
        await route.fulfill({ json: { success: true } });
    });

    await page.goto('/sell/onboarding');
    await expect(page.locator('#onboarding-form')).toBeVisible();

    await page.locator('#shop-name').fill('E2E Shop');
    await expect(page.locator('#shop-slug')).toHaveValue('e2e-shop');
    await page.locator('[data-next="2"]').click();
    await page.locator('textarea[name="description"]').fill('Critical seller onboarding test');
    await page.locator('[data-next="3"]').click();
    await page.locator('input[name="contact_email"]').fill('seller-e2e@example.test');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#step-4')).toBeVisible();
    expect(submitted).toMatchObject({
        name: 'E2E Shop',
        slug: 'e2e-shop',
        description: 'Critical seller onboarding test',
        contact_email: 'seller-e2e@example.test',
    });
});
});
