-- Copyright 2026 eiji ikemura
-- SPDX-License-Identifier: Apache-2.0

CREATE FUNCTION mb_demo_order_total (
    p_order_id IN NUMBER,
    p_discount_pct IN NUMBER
) RETURN NUMBER
IS
    v_subtotal NUMBER(12, 2);
    v_discount NUMBER(12, 2);
    v_shipping NUMBER(12, 2) := 0;
    v_total NUMBER(12, 2);
BEGIN
    SELECT SUM(quantity * unit_price)
      INTO v_subtotal
      FROM mb_demo_order_items
     WHERE order_id = p_order_id;

    IF v_subtotal IS NULL THEN
        RAISE_APPLICATION_ERROR(-20001, 'Order not found');
    END IF;
    IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
        RAISE_APPLICATION_ERROR(-20002, 'Discount must be between 0 and 100');
    END IF;

    v_discount := ROUND(v_subtotal * p_discount_pct / 100, 2);
    IF v_subtotal - v_discount < 200 THEN
        v_shipping := 9.90;
    END IF;
    v_total := v_subtotal - v_discount + v_shipping;
    RETURN v_total;
END mb_demo_order_total;
/
