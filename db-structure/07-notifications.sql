-- ============================================================
-- Notifications
-- Push subscriptions (PWA web-push) + an idempotency log of sent notifications.
-- The notification dispatcher (src/lib/notifications/dispatch.ts) claims a row in
-- notification_log via INSERT ... ON CONFLICT DO NOTHING before sending, so each
-- (order_id, type) is delivered at most once across webhooks, polling and cron.
-- ============================================================

-- ---------- Push subscriptions ----------
-- One row per browser/device subscription. Owned by the subscribing user; the
-- dispatcher reads them with the service-role client to send pushes.
CREATE TABLE public.push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users manage only their own subscriptions; the admin/service-role client bypasses RLS.
CREATE POLICY "Users can manage own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------- Notification log (dedupe ledger) ----------
-- service_role only (admin client bypasses RLS). UNIQUE(order_id, type) is the
-- dedupe key claimed before each send.
CREATE TABLE public.notification_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  recipient_user_id uuid,
  type text NOT NULL,
  email_status text,
  push_status text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (order_id, type)
);

CREATE INDEX idx_notification_log_order_id ON public.notification_log (order_id);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_log FROM anon, authenticated;
