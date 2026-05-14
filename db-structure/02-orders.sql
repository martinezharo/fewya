-- ============================================================
-- 02-orders.sql
-- Order management: orders, order_items, refunds
-- ============================================================

CREATE TYPE order_status AS ENUM ('pending', 'paid', 'processing', 'shipped', 'delivered', 'confirmed', 'incident', 'delivery_failed', 'cancelled', 'refunded');

CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  checkout_group_id text,
  buyer_id uuid,
  shop_id uuid,
  status order_status DEFAULT 'pending',
  payment_status text NOT NULL DEFAULT 'pending'::text,
  total_amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'eur'::text,
  has_insurance boolean DEFAULT false,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  paid_at timestamp with time zone,
  delivered_at timestamp with time zone,
  funds_released_at timestamp with time zone,
  cancellation_reason text,
  buyer_hidden_at timestamp with time zone,
  funds_release_status text NOT NULL DEFAULT 'pending' CHECK (funds_release_status IN ('pending', 'released', 'failed')),
  funds_release_last_error text,
  buyer_email text,
  shipping_full_name text,
  shipping_phone text,
  shipping_address text,
  delivery_type text DEFAULT 'home',
  pickup_point_id text,
  pickup_point_name text,
  pickup_point_address text,
  pickup_point_postal_code text,
  pickup_point_city text,
  pickup_point_carrier text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id),
  CONSTRAINT orders_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);

CREATE INDEX idx_orders_shop_id ON public.orders(shop_id);
CREATE INDEX idx_orders_checkout_group_id ON public.orders(checkout_group_id);
CREATE INDEX idx_orders_stripe_session ON public.orders(stripe_checkout_session_id);
CREATE INDEX idx_orders_stripe_payment ON public.orders(stripe_payment_intent_id);
CREATE INDEX idx_orders_buyer_id ON public.orders(buyer_id);
CREATE INDEX idx_orders_buyer_status ON public.orders(buyer_id, status);
CREATE INDEX idx_orders_delivered_pending_release ON public.orders(delivered_at)
    WHERE status = 'delivered' AND funds_released_at IS NULL;
CREATE INDEX idx_orders_buyer_not_hidden ON public.orders(buyer_id, created_at DESC)
    WHERE buyer_hidden_at IS NULL;

CREATE TABLE public.order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  quantity integer NOT NULL,
  price_at_purchase numeric NOT NULL,
  variant_id uuid,
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id)
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_order_items_variant_id ON public.order_items(variant_id);

CREATE TABLE public.refunds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'eur'::text,
  reason text,
  stripe_refund_id text,
  processed_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT refunds_pkey PRIMARY KEY (id),
  CONSTRAINT refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id)
);

CREATE INDEX idx_refunds_order_id ON public.refunds(order_id);

CREATE TABLE public.order_incidents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  description text NOT NULL,
  photos text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT order_incidents_pkey PRIMARY KEY (id),
  CONSTRAINT order_incidents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_incidents_order_id ON public.order_incidents(order_id);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.order_belongs_to_user(p_order_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = p_order_id AND buyer_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.order_belongs_to_seller(p_order_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = p_order_id AND s.owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_buyer_id uuid,
  p_public_id text,
  p_checkout_group_id text,
  p_shop_id uuid,
  p_total_amount numeric,
  p_currency text,
  p_stripe_checkout_session_id text,
  p_buyer_email text,
  p_shipping_full_name text,
  p_shipping_phone text,
  p_shipping_address text,
  p_items jsonb,
  p_delivery_type text DEFAULT 'home',
  p_pickup_point_id text DEFAULT NULL,
  p_pickup_point_name text DEFAULT NULL,
  p_pickup_point_address text DEFAULT NULL,
  p_pickup_point_postal_code text DEFAULT NULL,
  p_pickup_point_city text DEFAULT NULL,
  p_pickup_point_carrier text DEFAULT NULL
)
RETURNS public.orders AS $$
DECLARE
  new_order public.orders;
BEGIN
  IF p_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Buyer required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Checkout items required';
  END IF;

  INSERT INTO public.orders (
    public_id,
    checkout_group_id,
    buyer_id,
    shop_id,
    status,
    payment_status,
    total_amount,
    currency,
    stripe_checkout_session_id,
    buyer_email,
    shipping_full_name,
    shipping_phone,
    shipping_address,
    delivery_type,
    pickup_point_id,
    pickup_point_name,
    pickup_point_address,
    pickup_point_postal_code,
    pickup_point_city,
    pickup_point_carrier
  )
  VALUES (
    p_public_id,
    p_checkout_group_id,
    p_buyer_id,
    p_shop_id,
    'pending',
    'pending',
    p_total_amount,
    COALESCE(NULLIF(p_currency, ''), 'eur'),
    p_stripe_checkout_session_id,
    p_buyer_email,
    p_shipping_full_name,
    p_shipping_phone,
    p_shipping_address,
    COALESCE(NULLIF(p_delivery_type, ''), 'home'),
    p_pickup_point_id,
    p_pickup_point_name,
    p_pickup_point_address,
    p_pickup_point_postal_code,
    p_pickup_point_city,
    p_pickup_point_carrier
  )
  RETURNING * INTO new_order;

  INSERT INTO public.order_items (order_id, variant_id, quantity, price_at_purchase)
  SELECT
    new_order.id,
    (item->>'variant_id')::uuid,
    (item->>'quantity')::integer,
    (item->>'price_at_purchase')::numeric
  FROM jsonb_array_elements(p_items) item;

  RETURN new_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.reserve_stock(p_variant_id uuid, p_quantity integer)
RETURNS integer AS $$
DECLARE
  new_stock integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  UPDATE public.product_variants
  SET stock = stock - p_quantity
  WHERE id = p_variant_id AND stock >= p_quantity
  RETURNING stock INTO new_stock;

  IF new_stock IS NULL THEN
    RAISE EXCEPTION 'insufficient_stock';
  END IF;

  RETURN new_stock;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.restore_stock(p_variant_id uuid, p_quantity integer)
RETURNS void AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  UPDATE public.product_variants
  SET stock = stock + p_quantity
  WHERE id = p_variant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.mark_order_paid(
  p_buyer_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_payment_status text
)
RETURNS SETOF public.orders AS $$
DECLARE
  order_rec RECORD;
  item_rec RECORD;
BEGIN
  IF p_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Buyer required';
  END IF;

  FOR order_rec IN
    SELECT o.id FROM public.orders o
    WHERE o.buyer_id = p_buyer_id
      AND o.stripe_checkout_session_id = p_session_id
      AND o.payment_status <> 'paid'
  LOOP
    FOR item_rec IN
      SELECT oi.variant_id, oi.quantity FROM public.order_items oi
      WHERE oi.order_id = order_rec.id AND oi.variant_id IS NOT NULL
    LOOP
      PERFORM public.reserve_stock(item_rec.variant_id, item_rec.quantity);
    END LOOP;
  END LOOP;

  RETURN QUERY
  UPDATE public.orders
  SET
    status = CASE
      WHEN lower(COALESCE(p_payment_status, '')) = 'paid' THEN 'paid'
      ELSE status
    END,
    payment_status = COALESCE(p_payment_status, payment_status),
    stripe_payment_intent_id = COALESCE(p_payment_intent_id, stripe_payment_intent_id),
    paid_at = CASE
      WHEN lower(COALESCE(p_payment_status, '')) = 'paid' THEN COALESCE(paid_at, timezone('utc'::text, now()))
      ELSE paid_at
    END
  WHERE buyer_id = p_buyer_id
    AND stripe_checkout_session_id = p_session_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.cancel_order(p_actor_id uuid, p_order_id uuid, p_cancellation_reason text DEFAULT NULL)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
  item_rec RECORD;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = p_order_id AND s.owner_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Restore stock for all items in the order BEFORE cancelling.
  FOR item_rec IN
    SELECT oi.variant_id, oi.quantity FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.variant_id IS NOT NULL
  LOOP
    PERFORM public.restore_stock(item_rec.variant_id, item_rec.quantity);
  END LOOP;

  UPDATE public.orders
  SET status = 'cancelled',
      cancellation_reason = NULLIF(TRIM(p_cancellation_reason), '')
  WHERE id = p_order_id
    AND status IN ('paid', 'processing')
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or cannot be cancelled';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.mark_order_processing(p_actor_id uuid, p_order_id uuid)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = p_order_id AND s.owner_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.orders
  SET status = 'processing'
  WHERE id = p_order_id
    AND status = 'paid'
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or not in paid status';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_actor_id uuid, p_order_id uuid)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.orders
  SET
    status = 'confirmed',
    funds_released_at = timezone('utc'::text, now())
  WHERE id = p_order_id
    AND buyer_id = p_actor_id
    AND status = 'delivered'
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or not in delivered status';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.report_order_incident(
  p_actor_id uuid,
  p_order_id uuid,
  p_description text,
  p_photos text[] DEFAULT '{}'::text[]
)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
  desc_length integer;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  desc_length := LENGTH(REGEXP_REPLACE(COALESCE(p_description, ''), '\s', '', 'g'));
  IF desc_length < 50 THEN
    RAISE EXCEPTION 'Description too short. Minimum 50 non-space characters required.';
  END IF;

  IF array_length(p_photos, 1) IS NULL OR array_length(p_photos, 1) < 3 THEN
    RAISE EXCEPTION 'At least 3 photos are required.';
  END IF;

  IF array_length(p_photos, 1) > 20 THEN
    RAISE EXCEPTION 'Maximum 20 photos allowed.';
  END IF;

  UPDATE public.orders
  SET status = 'incident'
  WHERE id = p_order_id
    AND buyer_id = p_actor_id
    AND status IN ('delivered', 'confirmed')
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or cannot be reported';
  END IF;

  INSERT INTO public.order_incidents (order_id, description, photos)
  VALUES (p_order_id, p_description, p_photos);

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.resolve_incident_with_refund(
  p_actor_id uuid,
  p_order_id uuid
)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = p_order_id AND s.owner_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.orders
  SET status = 'refunded'
  WHERE id = p_order_id
    AND status = 'incident'
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not in incident status';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.resolve_delivery_failure_with_refund(
  p_actor_id uuid,
  p_order_id uuid
)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = p_order_id AND s.owner_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.orders
  SET status = 'refunded'
  WHERE id = p_order_id
    AND status = 'delivery_failed'
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not in delivery_failed status';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.auto_confirm_delivered_orders(p_actor_id uuid)
RETURNS TABLE(order_id uuid, public_id text) AS $$
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  UPDATE public.orders
  SET
    status = 'confirmed',
    funds_released_at = timezone('utc'::text, now())
  WHERE status = 'delivered'
    AND delivered_at < timezone('utc'::text, now()) - interval '48 hours'
    AND funds_released_at IS NULL
    AND (
      buyer_id = p_actor_id
      OR EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = orders.shop_id AND s.owner_id = p_actor_id
      )
    )
  RETURNING orders.id, orders.public_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Policies
-- ============================================================

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can create their own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK ((auth.uid() = buyer_id));
CREATE POLICY "Buyers can view their own orders" ON public.orders FOR SELECT TO authenticated USING ((auth.uid() = buyer_id));
CREATE POLICY "Sellers can view orders from their shop" ON public.orders FOR SELECT TO authenticated USING (
  shop_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.shops s
    WHERE s.id = orders.shop_id AND s.owner_id = auth.uid()
  )
);
CREATE POLICY "Sellers can view refunds from their shop" ON public.refunds FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = refunds.order_id AND s.owner_id = auth.uid()
  )
);
CREATE POLICY "Buyers can view refunds for their orders" ON public.refunds FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = refunds.order_id AND o.buyer_id = auth.uid()
  )
);
CREATE POLICY "Sellers can insert refunds for their shop" ON public.refunds FOR INSERT TO authenticated WITH CHECK (
  processed_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = refunds.order_id AND s.owner_id = auth.uid()
  )
);
CREATE POLICY "View items if you have access to the order" ON public.order_items FOR SELECT TO authenticated USING (order_belongs_to_user(order_id));
CREATE POLICY "Sellers can view order items from their shop" ON public.order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
    FROM ((product_variants pv
      JOIN products p ON ((pv.product_id = p.id)))
      JOIN shops s ON ((p.shop_id = s.id)))
    WHERE ((pv.id = order_items.variant_id) AND (s.owner_id = auth.uid())))));
CREATE POLICY "Allow inserting items if order is own" ON public.order_items FOR INSERT TO authenticated WITH CHECK (order_belongs_to_user(order_id));
CREATE POLICY "Buyers can view their own incidents" ON public.order_incidents FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_incidents.order_id AND o.buyer_id = auth.uid()
  )
);
CREATE POLICY "Sellers can view incidents from their shop" ON public.order_incidents FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON o.shop_id = s.id
    WHERE o.id = order_incidents.order_id AND s.owner_id = auth.uid()
  )
);

-- ============================================================
-- Grants
-- ============================================================

GRANT EXECUTE ON FUNCTION public.order_belongs_to_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_belongs_to_seller(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_stock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_checkout_order(uuid, text, text, uuid, numeric, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_order_paid(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_order_processing(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_order_delivery(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_order_incident(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_incident_with_refund(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_delivery_failure_with_refund(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_confirm_delivered_orders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(uuid, text, text, uuid, numeric, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_processing(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order_delivery(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_order_incident(uuid, uuid, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_incident_with_refund(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_failure_with_refund(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_confirm_delivered_orders(uuid) TO service_role;
