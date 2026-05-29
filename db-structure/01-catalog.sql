-- ============================================================
-- 01-catalog.sql
-- Product catalog: products, product_variants
-- ============================================================

-- Trigram similarity for typo-tolerant / partial search matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  -- Weighted full-text vector for search ranking. Priority: title > description > brand.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(brand, '')), 'C')
  ) STORED,
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT products_shop_id_slug_key UNIQUE (shop_id, slug)
);

CREATE INDEX products_search_vector_idx ON public.products USING gin (search_vector);
CREATE INDEX products_title_trgm_idx ON public.products USING gin (title gin_trgm_ops);
CREATE INDEX products_brand_trgm_idx ON public.products USING gin (brand gin_trgm_ops);

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Relevance-ranked product search. Matches via weighted full-text search plus
-- trigram word-similarity (typo tolerance), then filters shop visibility,
-- price and stock, orders and paginates — all DB-side. Returns the columns the
-- search grid consumes plus shop (json), variants (json) and a relevance score.
CREATE OR REPLACE FUNCTION public.search_products(
  p_query text DEFAULT '',
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_show_oos boolean DEFAULT false,
  p_sort text DEFAULT 'relevance',
  p_dir text DEFAULT 'desc',
  p_limit int DEFAULT 80,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  shop_id uuid,
  title text,
  description text,
  category text,
  gallery_images text[],
  is_active boolean,
  created_at timestamptz,
  brand text,
  slug text,
  shop json,
  variants json,
  relevance real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_raw text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq tsquery := websearch_to_tsquery('spanish', coalesce(p_query, ''));
BEGIN
  -- Broaden fuzzy word matching so single-letter typos still match (default is 0.6).
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.3', true);

  RETURN QUERY
  WITH base AS (
    SELECT
      p.id, p.shop_id, p.title, p.description, p.category, p.gallery_images,
      p.is_active, p.created_at, p.brand, p.slug,
      coalesce(
        (SELECT pv.price FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_default ORDER BY pv.created_at LIMIT 1),
        (SELECT pv.price FROM product_variants pv
          WHERE pv.product_id = p.id ORDER BY pv.created_at LIMIT 1),
        0
      ) AS default_price,
      EXISTS(
        SELECT 1 FROM product_variants pv
        WHERE pv.product_id = p.id AND coalesce(pv.stock, 0) > 0
      ) AS has_stock,
      (
        CASE
          WHEN v_raw IS NULL THEN 0::real
          ELSE
            ts_rank(p.search_vector, v_tsq)
            + word_similarity(v_raw, coalesce(p.title, '')) * 0.4
            + word_similarity(v_raw, coalesce(p.brand, '')) * 0.1
        END
      )::real AS relevance
    FROM products p
    JOIN shops s ON s.id = p.shop_id
    WHERE p.is_active
      AND s.status = 'active'
      AND s.payments_active
      AND s.seller_details_complete
      AND (
        v_raw IS NULL
        OR p.search_vector @@ v_tsq
        OR v_raw <% p.title
        OR v_raw <% coalesce(p.brand, '')
        OR p.title ILIKE '%' || v_raw || '%'
      )
  )
  SELECT
    b.id, b.shop_id, b.title, b.description, b.category, b.gallery_images,
    b.is_active, b.created_at, b.brand, b.slug,
    (
      SELECT to_json(sh) FROM (
        SELECT s2.id, s2.slug, s2.name, s2.accent_color,
               s2.payments_active, s2.seller_details_complete, s2.status
        FROM shops s2 WHERE s2.id = b.shop_id
      ) sh
    ) AS shop,
    (
      SELECT coalesce(json_agg(v), '[]'::json) FROM (
        SELECT pv.id, pv.price, pv.stock, pv.shipping_cost, pv.is_default,
               pv.variant_name, pv.weight_kg, pv.length_cm, pv.width_cm, pv.height_cm
        FROM product_variants pv WHERE pv.product_id = b.id
      ) v
    ) AS variants,
    b.relevance
  FROM base b
  WHERE (p_min_price IS NULL OR b.default_price >= p_min_price)
    AND (p_max_price IS NULL OR b.default_price <= p_max_price)
    AND (p_show_oos OR b.has_stock)
  ORDER BY
    CASE WHEN p_sort = 'price' AND p_dir = 'asc'  THEN b.default_price END ASC NULLS LAST,
    CASE WHEN p_sort = 'price' AND p_dir = 'desc' THEN b.default_price END DESC NULLS LAST,
    CASE WHEN p_sort = 'alpha' AND p_dir = 'asc'  THEN b.title END ASC,
    CASE WHEN p_sort = 'alpha' AND p_dir = 'desc' THEN b.title END DESC,
    CASE WHEN p_sort = 'date'  AND p_dir = 'asc'  THEN b.created_at END ASC,
    CASE WHEN p_sort = 'date'  AND p_dir = 'desc' THEN b.created_at END DESC,
    CASE WHEN p_sort = 'relevance' THEN b.relevance END DESC,
    b.created_at DESC
  LIMIT greatest(coalesce(p_limit, 80), 1)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

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

-- ============================================================
-- Grants
-- ============================================================

-- Trigger function: never callable via REST
REVOKE EXECUTE ON FUNCTION public.handle_new_product() FROM PUBLIC, anon, authenticated;

-- Search RPC: callable by buyers (anonymous and authenticated)
GRANT EXECUTE ON FUNCTION public.search_products(text, numeric, numeric, boolean, text, text, int, int) TO anon, authenticated;
