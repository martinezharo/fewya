-- ============================================================
-- 03-shipping.sql
-- Sendcloud shipping integration: sendcloud_config, shipments, shipment_tracking
-- ============================================================

-- Platform-wide Sendcloud configuration (single API key for all sellers)
CREATE TABLE public.sendcloud_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  api_key text NOT NULL,
  sender_name text,
  sender_company text,
  sender_address text,
  sender_city text,
  sender_postal_code text,
  sender_country text DEFAULT 'ES',
  sender_phone text,
  sender_email text,
  is_active boolean DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Shipment status enum
CREATE TYPE shipment_status AS ENUM ('pending', 'label_ready', 'shipped', 'delivered', 'failed', 'cancelled');

-- Shipments created via Sendcloud
CREATE TABLE public.shipments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  sendcloud_shipment_id text UNIQUE,
  sendcloud_reference text,
  carrier_id text,
  carrier_name text,
  service_name text,
  status shipment_status DEFAULT 'pending',
  tracking_number text,
  tracking_url text,
  price numeric(10,2),
  currency text DEFAULT 'EUR',
  label_url text,
  requested_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT shipments_pkey PRIMARY KEY (id),
  CONSTRAINT shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id)
);

-- Shipment tracking history
CREATE TABLE public.shipment_tracking (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL,
  status text NOT NULL,
  description text,
  location text,
  event_timestamp timestamp with time zone,
  raw_data jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT shipment_tracking_pkey PRIMARY KEY (id),
  CONSTRAINT shipment_tracking_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE
);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_shipment(
  p_actor_id uuid,
  p_order_id uuid,
  p_sendcloud_shipment_id text,
  p_sendcloud_reference text,
  p_carrier_id text,
  p_carrier_name text,
  p_service_name text,
  p_price numeric,
  p_tracking_number text,
  p_tracking_url text,
  p_label_url text
)
RETURNS public.shipments AS $$
DECLARE
  new_shipment public.shipments;
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

  INSERT INTO public.shipments (
    order_id,
    sendcloud_shipment_id,
    sendcloud_reference,
    carrier_id,
    carrier_name,
    service_name,
    price,
    tracking_number,
    tracking_url,
    label_url
  )
  VALUES (
    p_order_id,
    p_sendcloud_shipment_id,
    p_sendcloud_reference,
    p_carrier_id,
    p_carrier_name,
    p_service_name,
    p_price,
    p_tracking_number,
    p_tracking_url,
    p_label_url
  )
  RETURNING * INTO new_shipment;

  RETURN new_shipment;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_shipment_tracking(
  p_shipment_id uuid,
  p_status text,
  p_description text,
  p_location text,
  p_event_timestamp timestamp with time zone,
  p_tracking_number text,
  p_tracking_url text,
  p_raw_data jsonb
)
RETURNS public.shipments AS $$
DECLARE
  updated_shipment public.shipments;
  status_lower text;
  is_delivery_failure boolean;
BEGIN
  INSERT INTO public.shipment_tracking (shipment_id, status, description, location, event_timestamp, raw_data)
  VALUES (p_shipment_id, p_status, p_description, p_location, p_event_timestamp, p_raw_data);

  status_lower := lower(COALESCE(p_status, ''));
  is_delivery_failure :=
    status_lower IN ('failed', 'returned_to_sender', 'delivery_failed', 'shipment_lost', 'cancelled_upstream')
    OR status_lower LIKE '%returned to sender%'
    OR status_lower LIKE '%parcel en route to sender%'
    OR status_lower LIKE '%unable to deliver%'
    OR status_lower LIKE '%delivery attempt failed%'
    OR status_lower LIKE '%lost%';

  UPDATE public.shipments
  SET
    status = CASE
      WHEN p_status = 'delivered' THEN 'delivered'::shipment_status
      WHEN p_status = 'shipped' OR p_status = 'shipment.tracking.update' THEN 'shipped'::shipment_status
      WHEN p_status = 'label_ready' THEN 'label_ready'::shipment_status
      WHEN is_delivery_failure THEN 'failed'::shipment_status
      ELSE status
    END,
    tracking_number = COALESCE(p_tracking_number, tracking_number),
    tracking_url = COALESCE(p_tracking_url, tracking_url),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_shipment_id
  RETURNING * INTO updated_shipment;

  -- When shipment is delivered, update order status and set delivered_at
  IF p_status = 'delivered' AND updated_shipment.order_id IS NOT NULL THEN
    UPDATE public.orders
    SET
      status = 'delivered',
      delivered_at = COALESCE(delivered_at, timezone('utc'::text, now()))
    WHERE id = updated_shipment.order_id
      AND status NOT IN ('confirmed', 'incident', 'cancelled');
  END IF;

  -- When carrier reports loss or return-to-sender on a shipped order,
  -- transition it to delivery_failed so the seller can issue a refund.
  IF is_delivery_failure AND updated_shipment.order_id IS NOT NULL THEN
    UPDATE public.orders
    SET status = 'delivery_failed'
    WHERE id = updated_shipment.order_id
      AND status = 'shipped';
  END IF;

  RETURN updated_shipment;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_order_shipment(p_order_id uuid)
RETURNS public.shipments AS $$
  SELECT s.* FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.order_id = p_order_id
    AND (
      o.buyer_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.shops sh
        WHERE sh.id = o.shop_id AND sh.owner_id = auth.uid()
      )
    );
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- Policies
-- ============================================================

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can view shipments for their orders" ON public.shipments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = shipments.order_id AND orders.buyer_id = auth.uid()
  ));

CREATE POLICY "Sellers can view shipments for their shop orders" ON public.shipments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON s.id = o.shop_id
    WHERE o.id = shipments.order_id AND s.owner_id = auth.uid()
  ));

CREATE POLICY "Users can view tracking for shipments they have access to" ON public.shipment_tracking
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shipments s
    JOIN public.orders o ON s.order_id = o.id
    LEFT JOIN public.shops sh ON sh.id = o.shop_id
    WHERE s.id = shipment_tracking.shipment_id
      AND (o.buyer_id = auth.uid() OR sh.owner_id = auth.uid())
  ));

-- ============================================================
-- sendcloud_config: restrict to service_role only (C1)
-- ============================================================

ALTER TABLE public.sendcloud_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sendcloud_config FROM anon, authenticated;

-- ============================================================
-- Grants
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.create_shipment(uuid, uuid, text, text, text, text, text, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_shipment_tracking(uuid, text, text, text, timestamp with time zone, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_shipment(uuid, uuid, text, text, text, text, text, numeric, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_shipment_tracking(uuid, text, text, text, timestamp with time zone, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_order_shipment(uuid) TO authenticated;
