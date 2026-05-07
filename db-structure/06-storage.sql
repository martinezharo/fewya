-- ============================================================
-- 06-storage.sql
-- Storage buckets and policies
-- ============================================================

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

-- Storage bucket and policies for shipping labels (PDFs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('labels', 'labels', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf']
WHERE id = 'labels';

DROP POLICY IF EXISTS "Allow public read of shipping labels" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload shipping labels" ON storage.objects;
DROP POLICY IF EXISTS "Allow buyers and sellers to read shipping labels" ON storage.objects;
DROP POLICY IF EXISTS "Allow sellers to upload shipping labels" ON storage.objects;

CREATE POLICY "Allow buyers and sellers to read shipping labels" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'labels'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    LEFT JOIN public.shops s ON s.id = o.shop_id
    WHERE o.id = (storage.foldername(name))[1]::uuid
      AND (o.buyer_id = auth.uid() OR s.owner_id = auth.uid())
  )
);

CREATE POLICY "Allow sellers to upload shipping labels" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'labels'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shops s ON s.id = o.shop_id
    WHERE o.id = (storage.foldername(name))[1]::uuid
      AND s.owner_id = auth.uid()
  )
);
