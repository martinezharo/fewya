-- ============================================================
-- Migration: add cancellation_reason to orders
-- ============================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_reason text;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_cancellation_reason text DEFAULT NULL)
RETURNS public.orders AS $$
DECLARE
  updated_order public.orders;
  item_rec RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.order_belongs_to_seller(p_order_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Restore stock for all items in the order BEFORE cancelling.
  FOR item_rec IN
    SELECT oi.variant_id, oi.quantity FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.variant_id IS NOT NULL
  LOOP
    PERFORM public.restore_stock(item_rec.variant_id, item_rec.quantity);
  END LOOP;

  UPDATE public.orders
  SET status = 'cancelled',
      cancellation_reason = NULLIF(TRIM(p_cancellation_reason), '')
  WHERE id = p_order_id
    AND status IN ('paid', 'processing')
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or cannot be cancelled';
  END IF;

  RETURN updated_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;
