-- Copyright 2026 eiji ikemura
-- SPDX-License-Identifier: Apache-2.0

-- Run once in an empty demo account or schema. Existing objects are never dropped.
CREATE TABLE mb_demo_customers (
    customer_id NUMBER(10) PRIMARY KEY,
    customer_name VARCHAR2(80) NOT NULL,
    city VARCHAR2(40) NOT NULL
);

CREATE TABLE mb_demo_products (
    product_id NUMBER(10) PRIMARY KEY,
    product_name VARCHAR2(80) NOT NULL,
    category VARCHAR2(40) NOT NULL,
    unit_price NUMBER(12, 2) NOT NULL,
    CONSTRAINT mb_demo_products_price_ck CHECK (unit_price >= 0)
);

CREATE TABLE mb_demo_orders (
    order_id NUMBER(10) PRIMARY KEY,
    customer_id NUMBER(10) NOT NULL,
    ordered_at TIMESTAMP NOT NULL,
    status VARCHAR2(20) NOT NULL,
    CONSTRAINT mb_demo_orders_customer_fk FOREIGN KEY (customer_id)
        REFERENCES mb_demo_customers (customer_id),
    CONSTRAINT mb_demo_orders_status_ck CHECK (status IN ('Pending', 'Paid', 'Shipped'))
);

CREATE TABLE mb_demo_order_items (
    order_id NUMBER(10) NOT NULL,
    line_no NUMBER(10) NOT NULL,
    product_id NUMBER(10) NOT NULL,
    quantity NUMBER(10) NOT NULL,
    unit_price NUMBER(12, 2) NOT NULL,
    CONSTRAINT mb_demo_items_pk PRIMARY KEY (order_id, line_no),
    CONSTRAINT mb_demo_items_order_fk FOREIGN KEY (order_id)
        REFERENCES mb_demo_orders (order_id),
    CONSTRAINT mb_demo_items_product_fk FOREIGN KEY (product_id)
        REFERENCES mb_demo_products (product_id),
    CONSTRAINT mb_demo_items_quantity_ck CHECK (quantity > 0),
    CONSTRAINT mb_demo_items_price_ck CHECK (unit_price >= 0)
);

COMMENT ON TABLE mb_demo_customers IS 'Fictional customer accounts';
COMMENT ON TABLE mb_demo_products IS 'Demo catalog in USD';
COMMENT ON TABLE mb_demo_orders IS 'Customer orders and fulfillment status';
COMMENT ON TABLE mb_demo_order_items IS 'Order lines with prices captured at purchase';
COMMENT ON COLUMN mb_demo_order_items.unit_price IS 'Price per item in USD';

CREATE VIEW mb_demo_order_summary AS
SELECT o.order_id, c.customer_name, c.city, o.ordered_at, o.status,
       SUM(i.quantity) AS item_count,
       SUM(i.quantity * i.unit_price) AS subtotal_usd
FROM mb_demo_orders o
JOIN mb_demo_customers c ON c.customer_id = o.customer_id
JOIN mb_demo_order_items i ON i.order_id = o.order_id
GROUP BY o.order_id, c.customer_name, c.city, o.ordered_at, o.status;
