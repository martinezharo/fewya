-- ============================================================
-- 01-catalog.sql
-- Product catalog: products, product_variants
-- ============================================================

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
  CONSTRAINT products_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT products_shop_id_slug_key UNIQUE (shop_id, slug)
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
  shipping_cost numeric(8,2),
  CONSTRAINT product_variants_pkey PRIMARY KEY (id),
  CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE
);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_product()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.product_variants (product_id, price, stock, variant_name, is_default)
  VALUES (NEW.id, 0, 0, NULL, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER on_product_created
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_product();

-- ============================================================
-- Policies
-- ============================================================

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to products" ON public.products FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read access to products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow shop owners to insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to update products" ON public.products FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to delete products" ON public.products FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.shops WHERE id = shop_id AND owner_id = auth.uid()));
CREATE POLICY "Allow public read access to variants" ON public.product_variants FOR SELECT TO public USING (true);
CREATE POLICY "Allow shop owners to insert product variants" ON public.product_variants FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.products p JOIN public.shops s ON p.shop_id = s.id WHERE p.id = product_variants.product_id AND s.owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to update product variants" ON public.product_variants FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.products p JOIN public.shops s ON p.shop_id = s.id WHERE p.id = product_variants.product_id AND s.owner_id = auth.uid()));
CREATE POLICY "Allow shop owners to delete product variants" ON public.product_variants FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.products p JOIN public.shops s ON p.shop_id = s.id WHERE p.id = product_variants.product_id AND s.owner_id = auth.uid()));
