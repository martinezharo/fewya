// Source of truth for the buyer-confirmation hold window.
// IMPORTANT: keep in sync with db-structure/02-orders.sql `auto_confirm_delivered_orders`
// (interval '48 hours') — DB is the canonical enforcement, JS mirrors it for UI gating.
export const FUND_HOLD_HOURS = 48;
export const FUND_HOLD_MS = FUND_HOLD_HOURS * 60 * 60 * 1000;
