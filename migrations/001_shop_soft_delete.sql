-- ============================================================
-- Migration: 001_shop_soft_delete.sql
-- Add status column to shops for soft-delete support
-- ============================================================

-- 1. Add status column
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
CHECK (status IN ('active', 'inactive'));

-- 2. Index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_shops_status ON public.shops(status);

-- 3. Backfill existing rows (should already be 'active' via DEFAULT)
UPDATE public.shops SET status = 'active' WHERE status IS NULL;

-- 4. Update RLS policies: remove direct DELETE, keep UPDATE for owners
-- (Existing DELETE policy is replaced by soft-delete via UPDATE)
DROP POLICY IF EXISTS "Allow owners to delete their shops" ON public.shops;

-- 5. Ensure owners can update status to inactive
-- The existing UPDATE policy already covers this, but we keep it explicit.
-- No new policy needed because "Allow owners to update their shops" covers status.

-- 6. Add comment for clarity
COMMENT ON COLUMN public.shops.status IS 'Shop lifecycle: active or inactive (soft-delete). Never hard-delete shops with orders.';
