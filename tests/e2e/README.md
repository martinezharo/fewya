# Critical browser flows

The anonymous authentication checks need only a running test build with Clerk
configured. They check navigation between the real Clerk forms and removal of
the old service-worker page cache without creating or signing in to an account:

```sh
bun run build
bun run astro preview --host 127.0.0.1 --port 4331
# In another terminal:
E2E_BASE_URL=http://127.0.0.1:4331 bun run test:e2e tests/e2e/auth-navigation.spec.ts
```

Use a development Clerk instance for a local preview. These checks do not
complete Google OAuth; authenticated session routing and profile failures are
covered separately by `tests/unit/middleware-clerk.test.ts`.

The commerce tests run against an authenticated test deployment rather
than mocking authentication inside Astro. That keeps SSR authentication, middleware,
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

Without both variables the commerce suite reports both tests as skipped. This makes the
ordinary unit-test hook portable while CI or a developer with the disposable
fixture can run the browser suite explicitly.
