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
  total_amount numeric NOT NULL,
  has_insurance boolean DEFAULT false,
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

CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "Allow public read access to products" ON public.products FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow public read access to shops" ON public.shops FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to shops" ON public.shops FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow public read access to variants" ON public.product_variants FOR SELECT TO public USING (true);
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
