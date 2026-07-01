# TODO

## API handler test coverage

Only a handful of API routes are exercised directly (see `tests/unit/api-*.test.ts`
and `tests/unit/stripe-webhook.test.ts`). Follow the same pattern — `vi.mock` the
Supabase/Stripe/lib dependencies and invoke the route's `POST`/`GET` handler with a
mocked context — for the remaining critical routes that still lack coverage:

- [x] `POST /api/cart/checkout` — full orchestration (item resolution, seller-ready
      checks, per-shop Stripe session, order creation, rollback on failure).
- [x] `GET /api/auth/callback` — auth code exchange and new-buyer redirect (security).
- [x] `POST /api/orders/seller-confirm` — seller-side state transition.
- [ ] `POST /api/orders/refund-incident` — incident refund money path.
- [ ] `POST /api/reviews/submit` and `submit-batch` — review integrity.

Lower priority: the remaining CRUD routes under `/api/sell/*` and `/api/me/*` are
thin and RLS-protected; cover their pure logic in `lib/` rather than the handlers.
