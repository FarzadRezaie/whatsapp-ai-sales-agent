-- ============================================================
-- 061_product_images_paths.sql — fix product-images write policies
--
-- Migration 060 expected product photos under `{account_id}/...`, but
-- the app's shared uploader (src/lib/storage/upload-media.ts →
-- buildMediaPath) writes every account-scoped file under
-- `account-{account_id}/...` — the same convention as the chat-media
-- bucket (migration 023). With 060's policies every product photo
-- upload was rejected by RLS.
--
-- This replaces 060's three write policies with ones that match the
-- `account-{account_id}` folder AND require admin+ on that account
-- (products are admin-managed, same as the `products` table RLS).
-- Also adds an explicit public-read policy for parity with chat-media
-- (the bucket is public so Meta can fetch the photo URL).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DROP POLICY IF EXISTS product_images_insert ON storage.objects;
DROP POLICY IF EXISTS product_images_update ON storage.objects;
DROP POLICY IF EXISTS product_images_delete ON storage.objects;
DROP POLICY IF EXISTS product_images_select ON storage.objects;

CREATE POLICY product_images_select ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY product_images_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-images'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'admin')
    )
  );

CREATE POLICY product_images_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-images'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'admin')
    )
  );

CREATE POLICY product_images_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-images'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'admin')
    )
  );
