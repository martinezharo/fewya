CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  full_name text,
  avatar_url text,
  address text,
  phone text,
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
  CONSTRAINT product_variants_pkey PRIMARY KEY (id),
  CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  buyer_id uuid,
  status text DEFAULT 'pending'::text,
  payment_status text NOT NULL DEFAULT 'pending'::text,
  total_amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'eur'::text,
  has_insurance boolean DEFAULT false,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  paid_at timestamp with time zone,
  buyer_email text,
  shipping_full_name text,
  shipping_phone text,
  shipping_address text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id)
);
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

CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_public_id text,
  p_total_amount numeric,
  p_currency text,
  p_stripe_checkout_session_id text,
  p_buyer_email text,
  p_shipping_full_name text,
  p_shipping_phone text,
  p_shipping_address text,
  p_items jsonb
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
    buyer_id,
    status,
    payment_status,
    total_amount,
    currency,
    stripe_checkout_session_id,
    buyer_email,
    shipping_full_name,
    shipping_phone,
    shipping_address
  )
  VALUES (
    p_public_id,
    auth.uid(),
    'pending',
    'pending',
    p_total_amount,
    COALESCE(NULLIF(p_currency, ''), 'eur'),
    p_stripe_checkout_session_id,
    p_buyer_email,
    p_shipping_full_name,
    p_shipping_phone,
    p_shipping_address
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
  p_order_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_payment_status text
)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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
  WHERE id = p_order_id
    AND buyer_id = auth.uid()
    AND stripe_checkout_session_id = p_session_id
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
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

ALTER TABLE public.shop_payment_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "Allow public read access to products" ON public.products FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow public read access to shops" ON public.shops FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to shops" ON public.shops FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read access to payment accounts" ON public.shop_payment_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow public read access to variants" ON public.product_variants FOR SELECT TO public USING (true);
CREATE POLICY "Buyers can create their own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK ((auth.uid() = buyer_id));
CREATE POLICY "Buyers can view their own orders" ON public.orders FOR SELECT TO authenticated USING ((auth.uid() = buyer_id));
CREATE POLICY "Sellers can view orders from their shop" ON public.orders FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (((order_items oi
     JOIN product_variants pv ON ((oi.variant_id = pv.id)))
     JOIN products p ON ((pv.product_id = p.id)))
     JOIN shops s ON ((p.shop_id = s.id)))
  WHERE ((oi.order_id = orders.id) AND (s.owner_id = auth.uid())))));
CREATE POLICY "View items if you have access to the order" ON public.order_items FOR SELECT TO authenticated USING (order_belongs_to_user(order_id));
CREATE POLICY "Users can delete own wishlist" ON public.wishlist FOR DELETE TO authenticated USING ((auth.uid() = profile_id));
CREATE POLICY "Users can view own wishlist" ON public.wishlist FOR SELECT TO authenticated USING ((auth.uid() = profile_id));
CREATE POLICY "Allow public read access to reviews" ON public.reviews FOR SELECT TO public USING (true);
CREATE POLICY "Allow shop owners to insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to update products" ON public.products FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow authenticated users to insert shops" ON public.shops FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Allow owners to update their shops" ON public.shops FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Allow inserting into own wishlist" ON public.wishlist FOR INSERT TO authenticated WITH CHECK (auth.uid() = profile_id);
CREATE POLICY "Allow inserting reviews if product was purchased" ON public.reviews FOR INSERT TO authenticated WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o
  JOIN public.order_items oi ON o.id = oi.order_id
  JOIN public.product_variants pv ON oi.variant_id = pv.id
  WHERE o.buyer_id = auth.uid() AND pv.product_id = public.reviews.product_id
));

GRANT EXECUTE ON FUNCTION public.create_checkout_order(text, numeric, text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_shop_payment_account(uuid, text, boolean, boolean, boolean) TO authenticated;
