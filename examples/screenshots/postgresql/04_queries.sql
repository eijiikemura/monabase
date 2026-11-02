-- Copyright 2026 eiji ikemura
-- SPDX-License-Identifier: Apache-2.0

-- Select and execute one query at a time.
-- Hero screenshot: six rows ordered by date, with the SQL and results both visible.
SELECT o.order_id,
       c.customer_name,
       c.city,
       o.ordered_at,
       o.status,
       SUM(i.quantity) AS item_count,
       SUM(i.quantity * i.unit_price) AS subtotal_usd
FROM monabase_demo.mb_demo_orders o
JOIN monabase_demo.mb_demo_customers c ON c.customer_id = o.customer_id
JOIN monabase_demo.mb_demo_order_items i ON i.order_id = o.order_id
GROUP BY o.order_id, c.customer_name, c.city, o.ordered_at, o.status
ORDER BY o.ordered_at DESC, o.order_id DESC;

-- Optional detail screenshot: three rows for order 1001.
SELECT i.line_no, p.product_name, i.quantity,
       i.unit_price, i.quantity * i.unit_price AS line_total_usd
FROM monabase_demo.mb_demo_order_items i
JOIN monabase_demo.mb_demo_products p ON p.product_id = i.product_id
WHERE i.order_id = 1001
ORDER BY i.line_no;

-- Verify fixture counts: 4 customers, 4 products, 6 orders, 11 lines, USD 1790 subtotal.
SELECT (SELECT COUNT(*) FROM monabase_demo.mb_demo_customers) AS customers,
       (SELECT COUNT(*) FROM monabase_demo.mb_demo_products) AS products,
       (SELECT COUNT(*) FROM monabase_demo.mb_demo_orders) AS orders,
       totals.order_lines, totals.subtotal_usd
FROM (
    SELECT COUNT(*) AS order_lines,
           SUM(quantity * unit_price) AS subtotal_usd
    FROM monabase_demo.mb_demo_order_items
) totals;

-- Check both shipping branches before recording the trace.
SELECT monabase_demo.mb_demo_order_total(1001, 10) AS total_usd;
SELECT monabase_demo.mb_demo_order_total(1003, 10) AS total_usd;
-- Expected totals: 230.40 and 61.20 respectively.
