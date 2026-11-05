-- ==============================================================================
-- Harmonix Database Initialization Script
-- PostgreSQL 16 + pgvector Extension + E-commerce Sample Schema
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Create dedicated analytics schema
CREATE SCHEMA IF NOT EXISTS analytics;

-- 1. Customers Table (contains PII for testing masking guardrail)
CREATE TABLE IF NOT EXISTS analytics.customers (
    customer_id VARCHAR(50) PRIMARY KEY,
    customer_unique_id VARCHAR(50) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    email VARCHAR(100), -- PII
    phone_number VARCHAR(30), -- PII
    city VARCHAR(50) NOT NULL,
    state VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Products Table
CREATE TABLE IF NOT EXISTS analytics.products (
    product_id VARCHAR(50) PRIMARY KEY,
    product_category_name VARCHAR(50), -- Deliberately contains some NULLs / variations
    price NUMERIC(10, 2) NOT NULL,
    weight_g INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Orders Table
CREATE TABLE IF NOT EXISTS analytics.orders (
    order_id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) REFERENCES analytics.customers(customer_id),
    order_status VARCHAR(20) NOT NULL, -- 'delivered', 'shipped', 'canceled', 'invoiced'
    order_purchase_timestamp TIMESTAMP NOT NULL,
    order_delivered_timestamp TIMESTAMP
);

-- 4. Order Items Table
CREATE TABLE IF NOT EXISTS analytics.order_items (
    order_id VARCHAR(50) REFERENCES analytics.orders(order_id),
    order_item_id INT NOT NULL,
    product_id VARCHAR(50) REFERENCES analytics.products(product_id),
    price NUMERIC(10, 2) NOT NULL,
    freight_value NUMERIC(10, 2) DEFAULT 0.00,
    PRIMARY KEY (order_id, order_item_id)
);

-- 5. Order Payments Table
CREATE TABLE IF NOT EXISTS analytics.order_payments (
    order_id VARCHAR(50) REFERENCES analytics.orders(order_id),
    payment_sequential INT NOT NULL,
    payment_type VARCHAR(20) NOT NULL, -- 'credit_card', 'bank_transfer', 'voucher', 'e_wallet'
    payment_installments INT DEFAULT 1,
    payment_value NUMERIC(10, 2) NOT NULL,
    PRIMARY KEY (order_id, payment_sequential)
);

-- 6. Reviews Table
CREATE TABLE IF NOT EXISTS analytics.reviews (
    review_id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(50) REFERENCES analytics.orders(order_id),
    review_score INT NOT NULL CHECK (review_score BETWEEN 1 AND 5),
    review_comment_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Seed Initial Realistic Data
-- ==============================================================================

-- Seed Customers
INSERT INTO analytics.customers (customer_id, customer_unique_id, customer_name, email, phone_number, city, state, created_at)
VALUES
('cust_001', 'uid_001', 'Ahmad Pratama', 'ahmad.pratama@example.com', '+6281234567801', 'Jakarta Selatan', 'DKI', '2024-01-10 10:00:00'),
('cust_002', 'uid_002', 'Siti Rahma', 'siti.rahma@example.com', '+6281234567802', 'Bandung', 'JABAR', '2024-01-12 11:30:00'),
('cust_003', 'uid_003', 'Budi Santoso', 'budi.santoso@example.com', '+6281234567803', 'Surabaya', 'JATIM', '2024-01-15 09:15:00'),
('cust_004', 'uid_004', 'Dewi Lestari', 'dewi.lestari@example.com', '+6281234567804', 'Jakarta Pusat', 'DKI', '2024-02-01 14:20:00'),
('cust_005', 'uid_005', 'Rudi Hermawan', 'rudi.h@example.com', '+6281234567805', 'Medan', 'SUMUT', '2024-02-05 16:45:00'),
('cust_006', 'uid_006', 'Nina Wulandari', NULL, '+6281234567806', 'Semarang', 'JATENG', '2024-02-10 08:30:00'),
('cust_007', 'uid_007', 'Eko Prasetyo', 'eko.prasetyo@example.com', NULL, 'Yogyakarta', 'DIY', '2024-02-15 13:00:00'),
('cust_008', 'uid_008', 'Maya Indah', 'maya.indah@example.com', '+6281234567808', 'Denpasar', 'BALI', '2024-03-01 17:10:00')
ON CONFLICT (customer_id) DO NOTHING;

-- Seed Products
INSERT INTO analytics.products (product_id, product_category_name, price, weight_g, created_at)
VALUES
('prod_001', 'Electronics', 1500000.00, 1200, '2024-01-01 00:00:00'),
('prod_002', 'Electronics', 350000.00, 400, '2024-01-01 00:00:00'),
('prod_003', 'Fashion', 250000.00, 250, '2024-01-01 00:00:00'),
('prod_004', 'Fashion', 450000.00, 500, '2024-01-01 00:00:00'),
('prod_005', 'Home & Living', 750000.00, 3200, '2024-01-01 00:00:00'),
('prod_006', 'Home & Living', 120000.00, 600, '2024-01-01 00:00:00'),
('prod_007', 'Books', 95000.00, 350, '2024-01-01 00:00:00'),
('prod_008', NULL, 199000.00, 800, '2024-01-01 00:00:00') -- Deliberate NULL category for edge cases
ON CONFLICT (product_id) DO NOTHING;

-- Seed Orders
INSERT INTO analytics.orders (order_id, customer_id, order_status, order_purchase_timestamp, order_delivered_timestamp)
VALUES
('ord_001', 'cust_001', 'delivered', '2024-01-15 10:30:00', '2024-01-18 14:00:00'),
('ord_002', 'cust_002', 'delivered', '2024-01-20 15:00:00', '2024-01-24 11:20:00'),
('ord_003', 'cust_003', 'delivered', '2024-01-25 09:45:00', '2024-01-29 16:30:00'),
('ord_004', 'cust_004', 'delivered', '2024-02-05 11:10:00', '2024-02-08 10:15:00'),
('ord_005', 'cust_005', 'canceled', '2024-02-10 14:00:00', NULL),
('ord_006', 'cust_001', 'delivered', '2024-02-18 16:20:00', '2024-02-21 12:40:00'),
('ord_007', 'cust_006', 'delivered', '2024-02-22 08:50:00', '2024-02-26 15:00:00'),
('ord_008', 'cust_007', 'shipped', '2024-03-02 13:15:00', NULL),
('ord_009', 'cust_008', 'delivered', '2024-03-05 17:30:00', '2024-03-09 11:00:00'),
('ord_010', 'cust_002', 'delivered', '2024-03-10 10:00:00', '2024-03-13 14:30:00')
ON CONFLICT (order_id) DO NOTHING;

-- Seed Order Items
INSERT INTO analytics.order_items (order_id, order_item_id, product_id, price, freight_value)
VALUES
('ord_001', 1, 'prod_001', 1500000.00, 25000.00),
('ord_002', 1, 'prod_003', 250000.00, 15000.00),
('ord_002', 2, 'prod_004', 450000.00, 15000.00),
('ord_003', 1, 'prod_005', 750000.00, 35000.00),
('ord_004', 1, 'prod_002', 350000.00, 10000.00),
('ord_005', 1, 'prod_001', 1500000.00, 25000.00),
('ord_006', 1, 'prod_006', 120000.00, 12000.00),
('ord_007', 1, 'prod_007', 95000.00, 9000.00),
('ord_008', 1, 'prod_008', 199000.00, 18000.00),
('ord_009', 1, 'prod_003', 250000.00, 20000.00),
('ord_010', 1, 'prod_001', 1500000.00, 25000.00)
ON CONFLICT (order_id, order_item_id) DO NOTHING;

-- Seed Order Payments
INSERT INTO analytics.order_payments (order_id, payment_sequential, payment_type, payment_installments, payment_value)
VALUES
('ord_001', 1, 'credit_card', 3, 1525000.00),
('ord_002', 1, 'e_wallet', 1, 730000.00),
('ord_003', 1, 'bank_transfer', 1, 785000.00),
('ord_004', 1, 'e_wallet', 1, 360000.00),
('ord_005', 1, 'credit_card', 1, 1525000.00),
('ord_006', 1, 'bank_transfer', 1, 132000.00),
('ord_007', 1, 'credit_card', 1, 104000.00),
('ord_008', 1, 'e_wallet', 1, 217000.00),
('ord_009', 1, 'credit_card', 2, 270000.00),
('ord_010', 1, 'bank_transfer', 1, 1525000.00)
ON CONFLICT (order_id, payment_sequential) DO NOTHING;

-- Seed Reviews
INSERT INTO analytics.reviews (review_id, order_id, review_score, review_comment_message, created_at)
VALUES
('rev_001', 'ord_001', 5, 'Barang sangat bagus, pengiriman cepat!', '2024-01-19 09:00:00'),
('rev_002', 'ord_002', 5, 'Kualitas pakaian memuaskan.', '2024-01-25 14:00:00'),
('rev_003', 'ord_003', 4, 'Bagus tapi pengemasan agak tipis.', '2024-01-30 10:00:00'),
('rev_004', 'ord_004', 5, 'Produk elektronik berfungsi normal, mantap!', '2024-02-09 11:30:00'),
('rev_005', 'ord_006', 3, 'Cukup baik sesuai harga.', '2024-02-22 13:00:00'),
('rev_006', 'ord_007', 5, 'Buku original, pelayanan ramah.', '2024-02-27 16:00:00'),
('rev_007', 'ord_009', 5, 'Sangat puas belanja di sini!', '2024-03-10 12:00:00'),
('rev_008', 'ord_010', 5, 'Pelayanan cepat dan terpercaya.', '2024-03-14 15:30:00')
ON CONFLICT (review_id) DO NOTHING;

