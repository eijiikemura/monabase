-- Copyright 2026 eiji ikemura
-- SPDX-License-Identifier: Apache-2.0

-- Fictional, deterministic data. Run once after 01_schema.sql.
-- The final COMMIT makes the data visible to background metadata connections.

INSERT INTO mb_demo_customers (customer_id, customer_name, city)
VALUES (1, 'Northstar Studio', 'Tokyo');
INSERT INTO mb_demo_customers (customer_id, customer_name, city)
VALUES (2, 'Harbor Labs', 'Seattle');
INSERT INTO mb_demo_customers (customer_id, customer_name, city)
VALUES (3, 'Maple Works', 'Toronto');
INSERT INTO mb_demo_customers (customer_id, customer_name, city)
VALUES (4, 'Atlas Design', 'London');

INSERT INTO mb_demo_products (product_id, product_name, category, unit_price)
VALUES (101, 'Mechanical Keyboard', 'Accessories', 129);
INSERT INTO mb_demo_products (product_id, product_name, category, unit_price)
VALUES (102, 'USB-C Dock', 'Accessories', 89);
INSERT INTO mb_demo_products (product_id, product_name, category, unit_price)
VALUES (103, 'Studio Monitor', 'Displays', 249);
INSERT INTO mb_demo_products (product_id, product_name, category, unit_price)
VALUES (104, 'Braided USB-C Cable', 'Accessories', 19);

INSERT INTO mb_demo_orders (order_id, customer_id, ordered_at, status)
VALUES (1001, 1, TIMESTAMP '2026-02-02 10:00:00', 'Paid');
INSERT INTO mb_demo_orders (order_id, customer_id, ordered_at, status)
VALUES (1002, 2, TIMESTAMP '2026-02-03 10:00:00', 'Shipped');
INSERT INTO mb_demo_orders (order_id, customer_id, ordered_at, status)
VALUES (1003, 3, TIMESTAMP '2026-02-04 10:00:00', 'Pending');
INSERT INTO mb_demo_orders (order_id, customer_id, ordered_at, status)
VALUES (1004, 4, TIMESTAMP '2026-02-05 10:00:00', 'Paid');
INSERT INTO mb_demo_orders (order_id, customer_id, ordered_at, status)
VALUES (1005, 2, TIMESTAMP '2026-02-06 10:00:00', 'Shipped');
INSERT INTO mb_demo_orders (order_id, customer_id, ordered_at, status)
VALUES (1006, 1, TIMESTAMP '2026-02-07 10:00:00', 'Pending');

INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1001, 1, 101, 1, 129);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1001, 2, 102, 1, 89);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1001, 3, 104, 2, 19);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1002, 1, 103, 2, 249);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1002, 2, 102, 2, 89);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1003, 1, 104, 3, 19);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1004, 1, 101, 2, 129);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1004, 2, 104, 4, 19);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1005, 1, 103, 1, 249);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1005, 2, 101, 1, 129);
INSERT INTO mb_demo_order_items (order_id, line_no, product_id, quantity, unit_price)
VALUES (1006, 1, 102, 1, 89);

COMMIT;
