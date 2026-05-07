-- ============================================================
-- 00-base.sql
-- Core tables: profiles, shops, shop_payment_accounts
-- ============================================================

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
  default_weight_kg decimal(8,3),
  default_length_cm decimal(8,3),
  default_width_cm decimal(8,3),
  default_height_cm decimal(8,3),
  default_shipping_cost numeric(8,2),
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
-- Functions
-- ============================================================

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

CREATE OR REPLACE FUNCTION public.upsert_shop_payment_account(
  p_actor_id uuid,
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
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shops
    WHERE id = p_shop_id AND owner_id = p_actor_id
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

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Policies
-- ============================================================

ALTER TABLE public.shop_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "Allow public read access to shops" ON public.shops FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to shops" ON public.shops FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert shops" ON public.shops FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Allow owners to update their shops" ON public.shops FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Allow owners to delete their shops" ON public.shops FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Allow authenticated read access to payment accounts" ON public.shop_payment_accounts FOR SELECT TO authenticated USING (true);

-- ============================================================
-- Grants
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.upsert_shop_payment_account(uuid, uuid, text, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_shop_payment_account(uuid, uuid, text, boolean, boolean, boolean) TO service_role;
