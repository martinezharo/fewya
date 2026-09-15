import { expect, test } from '@playwright/test';

const configured = Boolean(
    process.env.E2E_BASE_URL
    && process.env.E2E_AUTH_STATE
    && process.env.E2E_SHIPPING_ORDER_ID,
);
const orderId = process.env.E2E_SHIPPING_ORDER_ID ?? '';

const quote = {
    carrierKey: 'inpost',
    carrierLabel: 'InPost',
    serviceName: 'Punto Pack',
    shippingOptionCode: 'inpost_es:service_point,national_c2c',
    grossPrice: 4.99,
    subsidy: 2.75,
    netDeduction: 2.24,
    buyerPaidShipping: 3.49,
    pickupPointName: 'Fixture service point',
    currency: 'EUR',
};

test.describe('seller shipping label flow', () => {
    test.skip(!configured, 'Set E2E_BASE_URL, E2E_AUTH_STATE and E2E_SHIPPING_ORDER_ID.');

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/sendcloud/order-label-cost?**', (route) => route.fulfill({ json: quote }));
        await page.goto('/sell/orders');
        await expect(page.locator(`article[data-order-id="${orderId}"]`)).toBeVisible();
    });

    test('generates, reloads, and opens a PDF label only after success', async ({ page }) => {
        const card = page.locator(`article[data-order-id="${orderId}"]`);
        await card.locator('.mock-label-btn').click();
        const modal = page.locator(`.label-cost-modal[data-order-id="${orderId}"]`);
        await expect(modal.locator('.label-cost-ready')).toBeVisible();

        await page.route('**/api/sendcloud/shipment', (route) => route.fulfill({
            json: {
                success: true,
                shipmentId: '900001',
                labelUrl: '/api/sendcloud/label?shipmentId=900001',
            },
        }));
        await page.route('**/sell/orders', (route) => route.fulfill({
            contentType: 'text/html',
            body: `<article data-order-id="${orderId}" data-order-status="processing">
                <a data-testid="shipping-label-link" href="/api/sendcloud/label?shipmentId=900001">View label</a>
            </article>`,
        }));
        await page.route('**/api/sendcloud/label?shipmentId=900001', (route) => route.fulfill({
            status: 200,
            contentType: 'application/pdf',
            body: Buffer.from('%PDF-1.7\n% deterministic browser fixture\n'),
        }));

        await modal.locator('.confirm-label-btn').click();
        await expect(page.locator(`article[data-order-id="${orderId}"]`)).toHaveAttribute('data-order-status', 'processing');
        const labelLink = page.getByTestId('shipping-label-link');
        await expect(labelLink).toBeVisible();

        const labelResponse = await labelLink.evaluate(async (link: HTMLAnchorElement) => {
            const response = await fetch(link.href);
            const bytes = new Uint8Array(await response.arrayBuffer());
            return {
                status: response.status,
                contentType: response.headers.get('content-type'),
                magic: new TextDecoder().decode(bytes.subarray(0, 4)),
            };
        });
        expect(labelResponse.status).toBe(200);
        expect(labelResponse.contentType).toContain('application/pdf');
        expect(labelResponse.magic).toBe('%PDF');
    });

    test('keeps a rejected order retryable and never exposes a label link', async ({ page }) => {
        const card = page.locator(`article[data-order-id="${orderId}"]`);
        await expect(card).toHaveAttribute('data-order-status', 'paid');
        await card.locator('.mock-label-btn').click();
        const modal = page.locator(`.label-cost-modal[data-order-id="${orderId}"]`);
        await expect(modal.locator('.label-cost-ready')).toBeVisible();

        let attempts = 0;
        await page.route('**/api/sendcloud/shipment', (route) => {
            attempts += 1;
            return route.fulfill({
                status: 422,
                json: { error: 'Sendcloud rejected the shipment: fixture rejection' },
            });
        });

        await modal.locator('.confirm-label-btn').click();
        await expect(page.getByRole('alert')).toContainText('fixture rejection');
        await expect(modal.locator('.confirm-label-btn')).toBeEnabled();
        await expect(card).toHaveAttribute('data-order-status', 'paid');
        await expect(card.getByTestId('shipping-label-link')).toHaveCount(0);

        await modal.locator('.confirm-label-btn').click();
        await expect.poll(() => attempts).toBe(2);
    });
});
