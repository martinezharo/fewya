-- ============================================================
-- 02-orders.sql
-- Order management: orders, order_items, refunds
-- ============================================================

CREATE TYPE order_status AS ENUM ('pending', 'paid', 'processing', 'shipped', 'delivered', 'confirmed', 'incident', 'cancelled');

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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
    auth.uid(),
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

CREATE OR REPLACE FUNCTION public.mark_order_paid(
  p_session_id text,
  p_payment_intent_id text,
  p_payment_status text
)
RETURNS SETOF public.orders AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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
  WHERE buyer_id = auth.uid()
    AND stripe_checkout_session_id = p_session_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.order_belongs_to_seller(p_order_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled'
  WHERE id = p_order_id
    AND status IN ('paid', 'processing')
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or cannot be cancelled';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.mark_order_processing(p_order_id uuid)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.order_belongs_to_seller(p_order_id) THEN
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

CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_order_id uuid)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.orders
  SET
    status = 'confirmed',
    funds_released_at = timezone('utc'::text, now())
  WHERE id = p_order_id
    AND buyer_id = auth.uid()
    AND status = 'delivered'
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or not in delivered status';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.report_order_incident(p_order_id uuid)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.orders
  SET status = 'incident'
  WHERE id = p_order_id
    AND buyer_id = auth.uid()
    AND status IN ('delivered', 'confirmed')
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or cannot be reported';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.auto_confirm_delivered_orders()
RETURNS TABLE(order_id uuid, public_id text) AS $$
BEGIN
  RETURN QUERY
  UPDATE public.orders
  SET
    status = 'confirmed',
    funds_released_at = timezone('utc'::text, now())
  WHERE status = 'delivered'
    AND delivered_at < timezone('utc'::text, now()) - interval '48 hours'
    AND funds_released_at IS NULL
  RETURNING orders.id, orders.public_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Policies
-- ============================================================

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can create their own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK ((auth.uid() = buyer_id));
CREATE POLICY "Buyers can view their own orders" ON public.orders FOR SELECT TO authenticated USING ((auth.uid() = buyer_id));
CREATE POLICY "Sellers can view orders from their shop" ON public.orders FOR SELECT TO authenticated USING (
  shop_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.shops s
    WHERE s.id = orders.shop_id AND s.owner_id = auth.uid()
  )
);
CREATE POLICY "View items if you have access to the order" ON public.order_items FOR SELECT TO authenticated USING (order_belongs_to_user(order_id));
CREATE POLICY "Sellers can view order items from their shop" ON public.order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
    FROM ((product_variants pv
      JOIN products p ON ((pv.product_id = p.id)))
      JOIN shops s ON ((p.shop_id = s.id)))
    WHERE ((pv.id = order_items.variant_id) AND (s.owner_id = auth.uid())))));
CREATE POLICY "Allow inserting items if order is own" ON public.order_items FOR INSERT TO authenticated WITH CHECK (order_belongs_to_user(order_id));

-- ============================================================
-- Grants
-- ============================================================

GRANT EXECUTE ON FUNCTION public.order_belongs_to_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_belongs_to_seller(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(text, text, uuid, numeric, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_processing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_order_incident(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_confirm_delivered_orders() TO authenticated;
