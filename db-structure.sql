CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  full_name text,
  first_name text,
  last_name text,
  avatar_url text,
  address text,
  address_street text,
  address_number text,
  address_floor text,
  address_postal_code text,
  address_city text,
  address_province text,
  address_country text DEFAULT 'ES',
  phone text,
  phone_prefix text DEFAULT '+34',
  is_seller boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.shops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  profile_img text,
  banner_img text,
  contact_email text,
  whatsapp text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  accent_color text,
  location text,
  CONSTRAINT shops_pkey PRIMARY KEY (id),
  CONSTRAINT shops_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.shop_payment_accounts (
  shop_id uuid NOT NULL,
  stripe_account_id text NOT NULL UNIQUE,
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  onboarding_completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT shop_payment_accounts_pkey PRIMARY KEY (shop_id),
  CONSTRAINT shop_payment_accounts_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE
);

ALTER TABLE public.shops ADD COLUMN default_weight_kg decimal(8,3);
ALTER TABLE public.shops ADD COLUMN default_length_cm decimal(8,3);
ALTER TABLE public.shops ADD COLUMN default_width_cm decimal(8,3);
ALTER TABLE public.shops ADD COLUMN default_height_cm decimal(8,3);
ALTER TABLE public.shops ADD COLUMN default_shipping_cost numeric(8,2);
ALTER TABLE public.product_variants ADD COLUMN shipping_cost numeric(8,2);
CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL,
  gallery_images text[] DEFAULT '{}'::text[],
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  brand text,
  specifications jsonb DEFAULT '{}'::jsonb,
  slug text NOT NULL,
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);
CREATE TABLE public.product_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  variant_name text,
  price numeric NOT NULL,
  stock integer DEFAULT 0,
  variant_image text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  is_default boolean DEFAULT false,
  weight_kg decimal(8,3),
  length_cm decimal(8,3),
  width_cm decimal(8,3),
  height_cm decimal(8,3),
  CONSTRAINT product_variants_pkey PRIMARY KEY (id),
  CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);

-- ============================================================
-- Profile Address Fields - Split address into structured fields
-- (Migrations applied to existing databases via 003_sendcloud_shipping.sql)
-- ============================================================

-- Migrate existing full_name to first_name if first_name is empty
-- UPDATE public.profiles
-- SET
--   first_name = COALESCE(SPLIT_PART(full_name, ' ', 1), ''),
--   last_name = CASE
--     WHEN POSITION(' ' IN full_name) > 0 THEN TRIM(SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1))
--     ELSE ''
--   END
-- WHERE first_name IS NULL AND full_name IS NOT NULL;

-- Migrate existing address to new structured fields (basic parsing)
-- UPDATE public.profiles
-- SET
--   address_postal_code = COALESCE(
--     NULLIF((REGEXP_MATCH(address, '[0-9]{5}'))[1], ''),
--     ''
--   )
-- WHERE address IS NOT NULL AND address_postal_code IS NULL;

-- ============================================================
-- Sendcloud Shipping Integration
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

-- RLS for shipments (buyers can view their order shipments, sellers can manage theirs)
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyers can view shipments for their orders" ON public.shipments;
DROP POLICY IF EXISTS "Sellers can view shipments for their shop orders" ON public.shipments;

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

-- RLS for shipment_tracking
ALTER TABLE public.shipment_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view tracking for shipments they have access to" ON public.shipment_tracking;

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
CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT reviews_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
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
CREATE TABLE public.wishlist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  product_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT wishlist_pkey PRIMARY KEY (id),
  CONSTRAINT wishlist_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT wishlist_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);

-- Views

CREATE VIEW public.public_profiles AS
SELECT 
    id, 
    full_name, 
    avatar_url 
FROM public.profiles;

-- Functions

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id, 
    NEW.email, 
    NEW.raw_user_meta_data->>'full_name', 
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_new_product()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.product_variants (product_id, price, stock, variant_name, is_default)
  VALUES (NEW.id, 0, 0, NULL, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

GRANT EXECUTE ON FUNCTION public.order_belongs_to_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_belongs_to_seller(uuid) TO authenticated;

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
  p_pickup_point_city text DEFAULT NULL
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
    pickup_point_city
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
    p_pickup_point_city
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

CREATE OR REPLACE FUNCTION public.upsert_shop_payment_account(
  p_shop_id uuid,
  p_stripe_account_id text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_details_submitted boolean
)
RETURNS public.shop_payment_accounts AS $$
DECLARE
  account_row public.shop_payment_accounts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shops
    WHERE id = p_shop_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  INSERT INTO public.shop_payment_accounts (
    shop_id,
    stripe_account_id,
    charges_enabled,
    payouts_enabled,
    details_submitted,
    onboarding_completed_at,
    updated_at
  )
  VALUES (
    p_shop_id,
    p_stripe_account_id,
    COALESCE(p_charges_enabled, false),
    COALESCE(p_payouts_enabled, false),
    COALESCE(p_details_submitted, false),
    CASE
      WHEN COALESCE(p_charges_enabled, false) AND COALESCE(p_payouts_enabled, false) AND COALESCE(p_details_submitted, false)
        THEN timezone('utc'::text, now())
      ELSE NULL
    END,
    timezone('utc'::text, now())
  )
  ON CONFLICT (shop_id) DO UPDATE
  SET
    stripe_account_id = EXCLUDED.stripe_account_id,
    charges_enabled = EXCLUDED.charges_enabled,
    payouts_enabled = EXCLUDED.payouts_enabled,
    details_submitted = EXCLUDED.details_submitted,
    onboarding_completed_at = CASE
      WHEN EXCLUDED.charges_enabled AND EXCLUDED.payouts_enabled AND EXCLUDED.details_submitted
        THEN COALESCE(public.shop_payment_accounts.onboarding_completed_at, timezone('utc'::text, now()))
      ELSE public.shop_payment_accounts.onboarding_completed_at
    END,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO account_row;

  RETURN account_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recreate policies deleted by CASCADE
CREATE POLICY "Allow inserting items if order is own" ON public.order_items FOR INSERT TO authenticated WITH CHECK (order_belongs_to_user(order_id));

-- Triggers

CREATE TRIGGER on_product_created
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_product();

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Policies

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "Allow public read access to products" ON public.products FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow public read access to shops" ON public.shops FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to shops" ON public.shops FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read access to payment accounts" ON public.shop_payment_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow public read access to variants" ON public.product_variants FOR SELECT TO public USING (true);
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
CREATE POLICY "Users can delete own wishlist" ON public.wishlist FOR DELETE TO authenticated USING ((auth.uid() = profile_id));
CREATE POLICY "Users can view own wishlist" ON public.wishlist FOR SELECT TO authenticated USING ((auth.uid() = profile_id));
CREATE POLICY "Allow public read access to reviews" ON public.reviews FOR SELECT TO public USING (true);
CREATE POLICY "Allow shop owners to insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to update products" ON public.products FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to delete products" ON public.products FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to insert product variants" ON public.product_variants FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.products p JOIN public.shops s ON p.shop_id = s.id WHERE p.id = product_variants.product_id AND s.owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to update product variants" ON public.product_variants FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.products p JOIN public.shops s ON p.shop_id = s.id WHERE p.id = product_variants.product_id AND s.owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to delete product variants" ON public.product_variants FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.products p JOIN public.shops s ON p.shop_id = s.id WHERE p.id = product_variants.product_id AND s.owner_id = auth.uid()));
CREATE POLICY "Allow authenticated users to insert shops" ON public.shops FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Allow owners to update their shops" ON public.shops FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Allow owners to delete their shops" ON public.shops FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Allow inserting into own wishlist" ON public.wishlist FOR INSERT TO authenticated WITH CHECK (auth.uid() = profile_id);
CREATE POLICY "Allow inserting reviews if product was purchased" ON public.reviews FOR INSERT TO authenticated WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o
  JOIN public.order_items oi ON o.id = oi.order_id
  JOIN public.product_variants pv ON oi.variant_id = pv.id
  WHERE o.buyer_id = auth.uid() AND pv.product_id = public.reviews.product_id
));

GRANT EXECUTE ON FUNCTION public.create_checkout_order(text, text, uuid, numeric, text, text, text, text, text, text, jsonb, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_processing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_shop_payment_account(uuid, text, boolean, boolean, boolean) TO authenticated;

-- Sendcloud shipment functions
CREATE OR REPLACE FUNCTION public.create_shipment(
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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

  -- When shipment is delivered, update order status and set delivered_at
  IF p_status = 'delivered' AND updated_shipment.order_id IS NOT NULL THEN
    UPDATE public.orders
    SET
      status = 'delivered',
      delivered_at = COALESCE(delivered_at, timezone('utc'::text, now()))
    WHERE id = updated_shipment.order_id
      AND status NOT IN ('confirmed', 'incident', 'cancelled');
  END IF;

  RETURN updated_shipment;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_order_shipment(p_order_id uuid)
RETURNS public.shipments AS $$
  SELECT s.* FROM public.shipments s WHERE s.order_id = p_order_id;
$$ LANGUAGE sql SECURITY DEFINER;

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

GRANT EXECUTE ON FUNCTION public.create_shipment(uuid, text, text, text, text, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shipment_tracking(uuid, text, text, text, timestamp with time zone, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_shipment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_order_incident(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_confirm_delivered_orders() TO authenticated;

-- Storage policies for imgs bucket (products folder)
DROP POLICY IF EXISTS "Allow authenticated users to upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update product images" ON storage.objects;
DROP POLICY IF EXISTS "Allow owners to delete their product images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read of product images" ON storage.objects;

CREATE POLICY "Allow public read of product images" ON storage.objects FOR SELECT USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'products');
CREATE POLICY "Allow authenticated users to upload product images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'products' AND (storage.foldername(name))[2]::uuid IN (SELECT id FROM shops WHERE owner_id = auth.uid()));
CREATE POLICY "Allow authenticated users to update product images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'products' AND (storage.foldername(name))[2]::uuid IN (SELECT id FROM shops WHERE owner_id = auth.uid()));
CREATE POLICY "Allow owners to delete their product images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'products' AND (storage.foldername(name))[2]::uuid IN (SELECT id FROM shops WHERE owner_id = auth.uid()));

CREATE POLICY "Allow public read of shop profile images" ON storage.objects FOR SELECT USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'profiles');
CREATE POLICY "Allow authenticated users to upload shop profile images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'profiles' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "Allow authenticated users to update shop profile images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'profiles' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "Allow owners to delete their shop profile images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'profiles' AND (storage.foldername(name))[2] = auth.uid()::text);

CREATE POLICY "Allow public read of shop banner images" ON storage.objects FOR SELECT USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'banners');
CREATE POLICY "Allow authenticated users to upload shop banner images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'banners' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "Allow authenticated users to update shop banner images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'banners' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "Allow owners to delete their shop banner images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'imgs' AND (storage.foldername(name))[1] = 'banners' AND (storage.foldername(name))[2] = auth.uid()::text);
