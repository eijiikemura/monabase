-- Copyright 2026 eiji ikemura
-- SPDX-License-Identifier: Apache-2.0

CREATE FUNCTION monabase_demo.mb_demo_order_total (
    p_order_id INTEGER,
    p_discount_pct NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_subtotal NUMERIC(12, 2);
    v_discount NUMERIC(12, 2);
    v_shipping NUMERIC(12, 2) := 0;
    v_total NUMERIC(12, 2);
BEGIN
    SELECT SUM(quantity * unit_price)
      INTO v_subtotal
      FROM monabase_demo.mb_demo_order_items
     WHERE order_id = p_order_id;

    IF v_subtotal IS NULL THEN
        RAISE EXCEPTION 'Order not found';
    END IF;
    IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
        RAISE EXCEPTION 'Discount must be between 0 and 100';
    END IF;

    v_discount := ROUND(v_subtotal * p_discount_pct / 100, 2);
    IF v_subtotal - v_discount < 200 THEN
        v_shipping := 9.90;
    END IF;
    v_total := v_subtotal - v_discount + v_shipping;
    RETURN v_total;
END;
$$;
