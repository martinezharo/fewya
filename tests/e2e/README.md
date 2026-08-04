# Critical browser flows

These tests deliberately run against an authenticated test deployment rather
than mocking Supabase inside Astro. That keeps SSR authentication, middleware,
and the rendered application in the path under test. The two state-changing
external boundaries (Stripe Checkout and shop creation) are intercepted, so a
run cannot charge a card or create a shop.

The storage state must belong to a test user with a complete buyer profile,
`is_seller = true`, and no existing shop. Never use a production account.

```sh
E2E_BASE_URL=https://test.example \
E2E_AUTH_STATE=/absolute/path/to/test-user-storage-state.json \
bun run test:e2e
```

Without both variables the suite reports both tests as skipped. This makes the
ordinary unit-test hook portable while CI or a developer with the disposable
fixture can run the browser suite explicitly.
