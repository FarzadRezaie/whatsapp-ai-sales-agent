-- ============================================================
-- 060_products.sql — Product catalog for AI photo matching
--
-- Each shop (account) registers its products: category, name,
-- description, price, sizes, colors, stock, and ONE main photo.
--
-- How the bot uses it:
--   1. Customer sends a photo.
--   2. Vision model detects the CATEGORY of the photo (shirt, dress...).
--   3. Customer photo + photos of only that category are compared.
--   4. Bot replies once with the matched product's own photo + price.
--
-- Storage: public bucket `product-images` so Meta can fetch the photo
-- URL when the bot sends it to the customer (same trade-off as the
-- `flow-media` bucket, migration 016).
--   Path convention: product-images/{account_id}/<file>
--   Writes allowed only for admin+ members of that account.
--
-- RLS mirrors ai_knowledge_documents (migration 030):
--   any member can read, admin+ can change.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. products table
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category     text NOT NULL,
  name         text NOT NULL,
  description  text,
  price        numeric(12,2) NOT NULL CHECK (price >= 0),
  currency     text NOT NULL DEFAULT 'AFN',
  sizes        text[] NOT NULL DEFAULT '{}',
  colors       text[] NOT NULL DEFAULT '{}',
  in_stock     boolean NOT NULL DEFAULT true,
  stock_note   text,
  image_path   text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_account_id_idx
  ON products (account_id);
CREATE INDEX IF NOT EXISTS products_account_category_idx
  ON products (account_id, category)
  WHERE is_active;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_products_updated_at();

-- ============================================================
-- 2. product-images storage bucket (public read, 5 MB images)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  TRUE,
  5242880, -- 5 MB = Meta's WhatsApp image cap
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Writes: first folder must be an account_id the user is admin+ of.
-- CASE guards the uuid cast so a non-uuid folder name returns false
-- instead of raising an error.
DROP POLICY IF EXISTS product_images_insert ON storage.objects;
CREATE POLICY product_images_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-images'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
      ELSE false
    END
  );

DROP POLICY IF EXISTS product_images_update ON storage.objects;
CREATE POLICY product_images_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-images'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
      ELSE false
    END
  );

DROP POLICY IF EXISTS product_images_delete ON storage.objects;
CREATE POLICY product_images_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-images'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
      ELSE false
    END
  );
