-- ============================================================
-- Profile Address Fields - Split address into structured fields
-- ============================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS address_street text,
ADD COLUMN IF NOT EXISTS address_number text,
ADD COLUMN IF NOT EXISTS address_floor text,
ADD COLUMN IF NOT EXISTS address_postal_code text,
ADD COLUMN IF NOT EXISTS address_city text,
ADD COLUMN IF NOT EXISTS address_province text,
ADD COLUMN IF NOT EXISTS address_country text DEFAULT 'ES',
ADD COLUMN IF NOT EXISTS phone_prefix text DEFAULT '+34';

-- Migrate existing full_name to first_name if first_name is empty
UPDATE public.profiles
SET
  first_name = COALESCE(SPLIT_PART(full_name, ' ', 1), ''),
  last_name = CASE
    WHEN POSITION(' ' IN full_name) > 0 THEN TRIM(SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1))
    ELSE ''
  END
WHERE first_name IS NULL AND full_name IS NOT NULL;

-- Migrate existing address to new structured fields (basic parsing)
UPDATE public.profiles
SET
  address_postal_code = COALESCE(
    NULLIF(REGEXP_MATCH(address, '\b\d{5}\b')[1], ''),
    ''
  )
WHERE address IS NOT NULL AND address_postal_code IS NULL;

-- ============================================================
-- Packlink Shipping Integration - Database Changes
-- Run this file to add shipping functionality to existing database
-- ============================================================

-- Add product dimensions columns to product_variants
ALTER TABLE public.product_variants
ADD COLUMN IF NOT EXISTS weight_kg decimal(8,3),
ADD COLUMN IF NOT EXISTS length_cm decimal(8,3),
ADD COLUMN IF NOT EXISTS width_cm decimal(8,3),
ADD COLUMN IF NOT EXISTS height_cm decimal(8,3);

-- Platform-wide Packlink configuration (single API key for all sellers)
CREATE TABLE IF NOT EXISTS public.packlink_config (
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
DO $$ BEGIN
    CREATE TYPE shipment_status AS ENUM ('pending', 'label_ready', 'shipped', 'delivered', 'failed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Shipments created in Packlink
CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  packlink_shipment_id text UNIQUE,
  packlink_reference text,
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
CREATE TABLE IF NOT EXISTS public.shipment_tracking (
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

-- RLS for shipments (buyers can view their order shipments, sellers can manage theirs)
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

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
    JOIN public.order_items oi ON o.id = oi.order_id
    JOIN public.product_variants pv ON oi.variant_id = pv.id
    JOIN public.products p ON pv.product_id = p.id
    JOIN public.shops s ON p.shop_id = s.id
    WHERE o.id = shipments.order_id AND s.owner_id = auth.uid()
  ));

ALTER TABLE public.shipment_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tracking for shipments they have access to" ON public.shipment_tracking
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shipments s
    JOIN public.orders o ON s.order_id = o.id
    WHERE s.id = shipment_tracking.shipment_id AND (
      o.buyer_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.orders o2
        JOIN public.order_items oi ON o2.id = oi.order_id
        JOIN public.product_variants pv ON oi.variant_id = pv.id
        JOIN public.products p ON pv.product_id = p.id
        JOIN public.shops sh ON p.shop_id = sh.id
        WHERE o2.id = s.order_id AND sh.owner_id = auth.uid()
      )
    )
  ));

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_shipment(
  p_order_id uuid,
  p_packlink_shipment_id text,
  p_packlink_reference text,
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.shipments (
    order_id,
    packlink_shipment_id,
    packlink_reference,
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
    p_packlink_shipment_id,
    p_packlink_reference,
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
BEGIN
  INSERT INTO public.shipment_tracking (shipment_id, status, description, location, event_timestamp, raw_data)
  VALUES (p_shipment_id, p_status, p_description, p_location, p_event_timestamp, p_raw_data);

  UPDATE public.shipments
  SET
    status = CASE
      WHEN p_status = 'delivered' THEN 'delivered'::shipment_status
      WHEN p_status = 'shipped' OR p_status = 'shipment.tracking.update' THEN 'shipped'::shipment_status
      WHEN p_status = 'label_ready' THEN 'label_ready'::shipment_status
      WHEN p_status = 'failed' THEN 'failed'::shipment_status
      ELSE status
    END,
    tracking_number = COALESCE(p_tracking_number, tracking_number),
    tracking_url = COALESCE(p_tracking_url, tracking_url),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_shipment_id
  RETURNING * INTO updated_shipment;

  RETURN updated_shipment;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_order_shipment(p_order_id uuid)
RETURNS public.shipments AS $$
  SELECT s.* FROM public.shipments s WHERE s.order_id = p_order_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- Grants
-- ============================================================

GRANT EXECUTE ON FUNCTION public.create_shipment(uuid, text, text, text, text, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shipment_tracking(uuid, text, text, text, timestamp with time zone, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_shipment(uuid) TO authenticated;