-- ============================================================
-- 04-social.sql
-- Social features: reviews, wishlist
-- ============================================================

CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  profile_id uuid,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  seller_reply text,
  seller_reply_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  is_auto boolean NOT NULL DEFAULT false,
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT reviews_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);

-- One auto-review per product at most
CREATE UNIQUE INDEX reviews_product_auto_unique ON public.reviews(product_id) WHERE is_auto = true;

CREATE TABLE public.wishlist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  product_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT wishlist_pkey PRIMARY KEY (id),
  CONSTRAINT wishlist_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT wishlist_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);

-- ============================================================
-- Policies
-- ============================================================

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to reviews" ON public.reviews FOR SELECT TO public USING (true);
CREATE POLICY "Allow inserting reviews if product was purchased" ON public.reviews FOR INSERT TO authenticated WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o
  JOIN public.order_items oi ON o.id = oi.order_id
  JOIN public.product_variants pv ON oi.variant_id = pv.id
  WHERE o.buyer_id = auth.uid() AND pv.product_id = public.reviews.product_id
));
CREATE POLICY "Users can update own reviews" ON public.reviews FOR UPDATE TO authenticated USING ((auth.uid() = profile_id)) WITH CHECK ((auth.uid() = profile_id));
CREATE POLICY "Users can delete own reviews" ON public.reviews FOR DELETE TO authenticated USING ((auth.uid() = profile_id));
CREATE POLICY "Users can view own wishlist" ON public.wishlist FOR SELECT TO authenticated USING ((auth.uid() = profile_id));
CREATE POLICY "Users can delete own wishlist" ON public.wishlist FOR DELETE TO authenticated USING ((auth.uid() = profile_id));
CREATE POLICY "Allow inserting into own wishlist" ON public.wishlist FOR INSERT TO authenticated WITH CHECK (auth.uid() = profile_id);
