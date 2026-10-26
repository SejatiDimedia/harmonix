"""Data Migration & Storytelling Seed for Harnessly Live BI Dashboard (2026).

Creates a realistic, cohesive, executive e-commerce dataset for full-year 2026:
- 35 Indonesian customers across major metropolitan areas
- 20 diverse products with categorized pricing and inventory
- 120 orders with realistic seasonal peaks (Ramadan, 6.6 Festival, 9.9 & 10.10 Harbolnas)
- Multi-channel payments (QRIS, E-Wallet, VA, Credit Card)
- 5 Pre-pinned Live BI Dashboard widgets (Line, Doughnut, Bar, Pie, Table)
- Showcase conversational session with SQL transparency and audit badges
"""

import asyncio
import json
import logging
import random
from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from src.db.connection import get_db_session
from src.agent.state import init_task_state_table
from src.dashboard.manager import init_dashboard_table

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed_demo")

DEMO_SESSION_ID = "ses_demo_eksekutif_2026"
DEMO_SESSION_TITLE = "Laporan Eksekutif Pertumbuhan Bisnis & Pelanggan 2026"

# 1. Product Master Catalog
PRODUCTS = [
    # Electronics
    ("prod_e01", "Electronics", 12500000.00, 1600), # Laptop Pro 14
    ("prod_e02", "Electronics", 1850000.00, 350),  # TWS Earphone Pro
    ("prod_e03", "Electronics", 3200000.00, 420),  # Smartwatch Ultra GPS
    ("prod_e04", "Electronics", 1450000.00, 950),  # Mechanical Keyboard RGB
    ("prod_e05", "Electronics", 4500000.00, 5200), # Monitor 4K 27 Inch
    ("prod_e06", "Electronics", 450000.00, 220),   # GaN Fast Charger 65W
    # Fashion
    ("prod_f01", "Fashion", 375000.00, 300),       # Kemeja Linen Slim Fit
    ("prod_f02", "Fashion", 650000.00, 650),       # Jaket Windbreaker Urban
    ("prod_f03", "Fashion", 420000.00, 450),       # Celana Chino Stretch
    ("prod_f04", "Fashion", 850000.00, 400),       # Batik Tulis Pekalongan
    ("prod_f05", "Fashion", 790000.00, 850),       # Sneakers Kasual Lokal
    # Home & Living
    ("prod_h01", "Home & Living", 1250000.00, 4100), # Air Fryer Digital 4L
    ("prod_h02", "Home & Living", 350000.00, 600),   # Diffuser Aromaterapi Ultrasonic
    ("prod_h03", "Home & Living", 2850000.00, 14000), # Meja Kerja Ergonomis Adjustable
    ("prod_h04", "Home & Living", 195000.00, 500),   # Lampu Meja Belajar LED
    # Health & Beauty
    ("prod_b01", "Health & Beauty", 185000.00, 120), # Serum Niacinamide 10%
    ("prod_b02", "Health & Beauty", 145000.00, 90),  # Sunscreen Watery Gel SPF 50
    ("prod_b03", "Health & Beauty", 95000.00, 250),  # Sabun Mandi Organik Herbal
    # Books & Education
    ("prod_k01", "Books", 135000.00, 400),           # Buku Algoritma & AI Agent
    ("prod_k02", "Books", 115000.00, 350),           # Buku Manajemen Finansial Praktis
]

# 2. Customer Master Catalog
CUSTOMERS = [
    ("cust_01", "Ahmad Pratama", "ahmad.p@example.com", "+6281234567801", "Jakarta Selatan", "DKI"),
    ("cust_02", "Siti Rahmawati", "siti.rahma@example.com", "+6281234567802", "Bandung", "JABAR"),
    ("cust_03", "Budi Santoso", "budi.s@example.com", "+6281234567803", "Surabaya", "JATIM"),
    ("cust_04", "Dewi Lestari", "dewi.lestari@example.com", "+6281234567804", "Jakarta Pusat", "DKI"),
    ("cust_05", "Rudi Hermawan", "rudi.h@example.com", "+6281234567805", "Medan", "SUMUT"),
    ("cust_06", "Nina Wulandari", "nina.w@example.com", "+6281234567806", "Semarang", "JATENG"),
    ("cust_07", "Eko Prasetyo", "eko.p@example.com", "+6281234567807", "Yogyakarta", "DIY"),
    ("cust_08", "Maya Indah", "maya.indah@example.com", "+6281234567808", "Denpasar", "BALI"),
    ("cust_09", "Fajar Hidayat", "fajar.h@example.com", "+6281234567809", "Bekasi", "JABAR"),
    ("cust_10", "Rina Marlina", "rina.m@example.com", "+6281234567810", "Tangerang", "BANTEN"),
    ("cust_11", "Andi Wijaya", "andi.w@example.com", "+6281234567811", "Makassar", "SULSEL"),
    ("cust_12", "Citra Kirana", "citra.k@example.com", "+6281234567812", "Jakarta Barat", "DKI"),
    ("cust_13", "Dian Sastro", "dian.s@example.com", "+6281234567813", "Jakarta Timur", "DKI"),
    ("cust_14", "Guruh Soekarno", "guruh.s@example.com", "+6281234567814", "Malang", "JATIM"),
    ("cust_15", "Hani Pratiwi", "hani.p@example.com", "+6281234567815", "Bogor", "JABAR"),
    ("cust_16", "Indra Gunawan", "indra.g@example.com", "+6281234567816", "Solo", "JATENG"),
    ("cust_17", "Joko Widodo", "joko.w@example.com", "+6281234567817", "Jakarta Selatan", "DKI"),
    ("cust_18", "Kartika Putri", "kartika.p@example.com", "+6281234567818", "Palembang", "SUMSEL"),
    ("cust_19", "Lukman Hakim", "lukman.h@example.com", "+6281234567819", "Balikpapan", "KALTIM"),
    ("cust_20", "Mega Utami", "mega.u@example.com", "+6281234567820", "Depok", "JABAR"),
    ("cust_21", "Naufal Zaki", "naufal.z@example.com", "+6281234567821", "Cimahi", "JABAR"),
    ("cust_22", "Olivia Jensen", "olivia.j@example.com", "+6281234567822", "Badung", "BALI"),
    ("cust_23", "Panji Trihatmodjo", "panji.t@example.com", "+6281234567823", "Jakarta Utara", "DKI"),
    ("cust_24", "Qori Sandioriva", "qori.s@example.com", "+6281234567824", "Banda Aceh", "ACEH"),
    ("cust_25", "Reza Rahadian", "reza.r@example.com", "+6281234567825", "Jakarta Selatan", "DKI"),
    ("cust_26", "Sari Nila", "sari.n@example.com", "+6281234567826", "Surabaya", "JATIM"),
    ("cust_27", "Taufik Hidayat", "taufik.h@example.com", "+6281234567827", "Bandung", "JABAR"),
    ("cust_28", "Umar Bakri", "umar.b@example.com", "+6281234567828", "Padang", "SUMBAR"),
    ("cust_29", "Vina Panduwinata", "vina.p@example.com", "+6281234567829", "Bogor", "JABAR"),
    ("cust_30", "Wawan Hendrawan", "wawan.h@example.com", "+6281234567830", "Sleman", "DIY"),
    ("cust_31", "Yuni Shara", "yuni.s@example.com", "+6281234567831", "Batu", "JATIM"),
    ("cust_32", "Zainal Abidin", "zainal.a@example.com", "+6281234567832", "Pekanbaru", "RIAU"),
    ("cust_33", "Bambang Pamungkas", "bambang.p@example.com", "+6281234567833", "Semarang", "JATENG"),
    ("cust_34", "Najwa Shihab", "najwa.s@example.com", "+6281234567834", "Jakarta Pusat", "DKI"),
    ("cust_35", "Titi Kamal", "titi.k@example.com", "+6281234567835", "Jakarta Selatan", "DKI"),
]

# Seasonal Monthly Order Counts for 2026 (Jan to Oct 2026)
# Peaks in April (Lebaran), June (Mid-year 6.6), Sep (9.9), Oct (10.10)
MONTHLY_PLAN = [
    (1, 8),   # Jan
    (2, 10),  # Feb
    (3, 14),  # Mar (Ramadan begins)
    (4, 20),  # Apr (Lebaran Peak)
    (5, 11),  # May
    (6, 16),  # Jun (Mid-Year 6.6)
    (7, 12),  # Jul
    (8, 14),  # Aug (Kemerdekaan)
    (9, 16),  # Sep (9.9)
    (10, 15), # Oct (10.10)
]

PAYMENT_TYPES = ["e_wallet", "bank_transfer", "credit_card", "voucher"]
PAYMENT_WEIGHTS = [0.42, 0.35, 0.15, 0.08]

REVIEW_TEMPLATES = [
    (5, "Produk sangat berkualitas, packing aman dan pengiriman cepat!"),
    (5, "Sesuai deskripsi, respon penjual sangat ramah dan memuaskan."),
    (5, "Keren banget, sudah dicoba dan berfungsi dengan sempurna."),
    (4, "Barang bagus, hanya saja kurir agak terlambat 1 hari."),
    (4, "Kualitas memuaskan untuk harganya, recomended seller!"),
    (3, "Cukup baik, berfungsi normal meski kemasan luar agak penyok."),
    (5, "Sangat puas berbelanja di sini, bakal repeat order lagi."),
]


async def migrate_and_seed_data():
    """Execute complete data migration and demo dashboard setup."""
    logger.info("Initializing schema tables...")
    await init_task_state_table()
    await init_dashboard_table()

    random.seed(42)  # Deterministic seed for reproducible executive presentation

    async with get_db_session() as session:
        # Schema migration: allow longer state names if needed
        await session.execute(text("ALTER TABLE analytics.customers ALTER COLUMN state TYPE VARCHAR(50);"))

        # 1. Clean existing demo orders / products if necessary or upsert
        logger.info("Upserting Products Catalog...")
        for pid, cat, price, weight in PRODUCTS:
            await session.execute(
                text("""
                    INSERT INTO analytics.products (product_id, product_category_name, price, weight_g, created_at)
                    VALUES (:pid, :cat, :price, :weight, '2026-01-01 00:00:00')
                    ON CONFLICT (product_id) DO UPDATE SET
                        product_category_name = EXCLUDED.product_category_name,
                        price = EXCLUDED.price,
                        weight_g = EXCLUDED.weight_g;
                """),
                {"pid": pid, "cat": cat, "price": price, "weight": weight},
            )

        logger.info("Upserting Customers Catalog...")
        for cid, name, email, phone, city, state in CUSTOMERS:
            await session.execute(
                text("""
                    INSERT INTO analytics.customers (customer_id, customer_unique_id, customer_name, email, phone_number, city, state, created_at)
                    VALUES (:cid, :uid, :name, :email, :phone, :city, :state, '2026-01-01 00:00:00')
                    ON CONFLICT (customer_id) DO UPDATE SET
                        customer_name = EXCLUDED.customer_name,
                        email = EXCLUDED.email,
                        phone_number = EXCLUDED.phone_number,
                        city = EXCLUDED.city,
                        state = EXCLUDED.state;
                """),
                {"cid": cid, "uid": f"uid_{cid}", "name": name, "email": email, "phone": phone, "city": city, "state": state},
            )

        # 2. Generate Orders, Items, Payments, Reviews for 2026
        logger.info("Generating 2026 Orders with seasonal business narrative...")
        order_counter = 1
        created_orders = []

        for month, count in MONTHLY_PLAN:
            for _ in range(count):
                day = random.randint(1, 28)
                hour = random.randint(8, 21)
                minute = random.randint(0, 59)
                order_time = datetime(2026, month, day, hour, minute, 0)
                deliv_time = order_time + timedelta(days=random.randint(2, 4), hours=random.randint(1, 6))

                order_id = f"ord_2026_{order_counter:04d}"
                cust = random.choice(CUSTOMERS)
                cust_id = cust[0]

                # 90% delivered, 6% shipped, 4% canceled
                status_roll = random.random()
                if status_roll < 0.90:
                    status = "delivered"
                elif status_roll < 0.96:
                    status = "shipped"
                    deliv_time = None
                else:
                    status = "canceled"
                    deliv_time = None

                await session.execute(
                    text("""
                        INSERT INTO analytics.orders (order_id, customer_id, order_status, order_purchase_timestamp, order_delivered_timestamp)
                        VALUES (:order_id, :customer_id, :status, :p_time, :d_time)
                        ON CONFLICT (order_id) DO UPDATE SET
                            order_status = EXCLUDED.order_status,
                            order_purchase_timestamp = EXCLUDED.order_purchase_timestamp,
                            order_delivered_timestamp = EXCLUDED.order_delivered_timestamp;
                    """),
                    {
                        "order_id": order_id,
                        "customer_id": cust_id,
                        "status": status,
                        "p_time": order_time,
                        "d_time": deliv_time,
                    },
                )

                # Order Items: 1 to 3 items per order
                num_items = random.choices([1, 2, 3], weights=[0.65, 0.25, 0.10])[0]
                total_order_price = 0.0
                total_freight = 0.0

                for item_seq in range(1, num_items + 1):
                    prod = random.choice(PRODUCTS)
                    prod_id = prod[0]
                    price = prod[2]
                    # Calculate realistic freight based on location
                    base_freight = 12000.0 if "DKI" in cust[5] or "Jawa" in cust[5] else 35000.0
                    freight = base_freight + (prod[3] / 1000.0) * 4000.0

                    total_order_price += price
                    total_freight += freight

                    await session.execute(
                        text("""
                            INSERT INTO analytics.order_items (order_id, order_item_id, product_id, price, freight_value)
                            VALUES (:order_id, :item_id, :product_id, :price, :freight)
                            ON CONFLICT (order_id, order_item_id) DO UPDATE SET
                                product_id = EXCLUDED.product_id,
                                price = EXCLUDED.price,
                                freight_value = EXCLUDED.freight_value;
                        """),
                        {
                            "order_id": order_id,
                            "item_id": item_seq,
                            "product_id": prod_id,
                            "price": price,
                            "freight": freight,
                        },
                    )

                # Order Payments
                p_type = random.choices(PAYMENT_TYPES, weights=PAYMENT_WEIGHTS)[0]
                installments = random.choice([3, 6, 12]) if p_type == "credit_card" and total_order_price > 2000000 else 1
                total_payment = total_order_price + total_freight

                await session.execute(
                    text("""
                        INSERT INTO analytics.order_payments (order_id, payment_sequential, payment_type, payment_installments, payment_value)
                        VALUES (:order_id, 1, :p_type, :inst, :val)
                        ON CONFLICT (order_id, payment_sequential) DO UPDATE SET
                            payment_type = EXCLUDED.payment_type,
                            payment_installments = EXCLUDED.payment_installments,
                            payment_value = EXCLUDED.payment_value;
                    """),
                    {
                        "order_id": order_id,
                        "p_type": p_type,
                        "inst": installments,
                        "val": total_payment,
                    },
                )

                # Reviews for delivered orders
                if status == "delivered":
                    score, comment = random.choice(REVIEW_TEMPLATES)
                    rev_id = f"rev_{order_id}"
                    await session.execute(
                        text("""
                            INSERT INTO analytics.reviews (review_id, order_id, review_score, review_comment_message, created_at)
                            VALUES (:rev_id, :order_id, :score, :comment, :c_time)
                            ON CONFLICT (review_id) DO UPDATE SET
                                review_score = EXCLUDED.review_score,
                                review_comment_message = EXCLUDED.review_comment_message;
                        """),
                        {
                            "rev_id": rev_id,
                            "order_id": order_id,
                            "score": score,
                            "comment": comment,
                            "c_time": deliv_time + timedelta(hours=random.randint(12, 48)),
                        },
                    )

                created_orders.append(order_id)
                order_counter += 1

        logger.info(f"Successfully generated {len(created_orders)} orders across 2026.")

        # 3. Create Showcase Chat Session
        logger.info("Setting up Showcase Chat Session in analytics.chat_sessions...")
        await session.execute(
            text("""
                INSERT INTO analytics.chat_sessions (session_id, title, created_at, updated_at)
                VALUES (:sid, :title, '2026-10-26 10:00:00', CURRENT_TIMESTAMP)
                ON CONFLICT (session_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    updated_at = CURRENT_TIMESTAMP;
            """),
            {"sid": DEMO_SESSION_ID, "title": DEMO_SESSION_TITLE},
        )

        # 4. Clear old demo widgets for clean migration
        await session.execute(
            text("DELETE FROM analytics.dashboard_widgets WHERE session_id = :sid;"),
            {"sid": DEMO_SESSION_ID},
        )

        # 5. Seed 5 High-Impact Live Dashboard Widgets with Live SQL Queries
        logger.info("Seeding 5 storytelling Live Dashboard widgets...")

        # --- Widget 1: Line Chart (Monthly Revenue Growth) ---
        q_line = """SELECT TO_CHAR(o.order_purchase_timestamp, 'YYYY-MM') AS bulan, SUM(oi.price) AS total_omset
FROM analytics.orders o
JOIN analytics.order_items oi ON o.order_id = oi.order_id
WHERE o.order_status = 'delivered'
GROUP BY 1 ORDER BY 1;"""

        res_line = await session.execute(text(q_line))
        rows_line = res_line.fetchall()
        chart_line_data = [{"bulan": str(r[0]), "total_omset": float(r[1])} for r in rows_line]
        table_line_data = {"columns": ["bulan", "total_omset"], "rows": [[str(r[0]), float(r[1])] for r in rows_line], "row_count": len(rows_line)}

        await session.execute(
            text("""
                INSERT INTO analytics.dashboard_widgets (widget_id, session_id, widget_type, title, sql_query, chart_spec, table_data, created_at, updated_at)
                VALUES ('wgt_demo_line', :sid, 'chart', 'Tren Pertumbuhan Pendapatan Bulanan (Jan - Okt 2026)', :sql, :chart, :tbl, '2026-10-26 10:01:00', CURRENT_TIMESTAMP);
            """),
            {
                "sid": DEMO_SESSION_ID,
                "sql": q_line,
                "chart": json.dumps({
                    "chart_type": "line",
                    "title": "Tren Pertumbuhan Pendapatan Bulanan (Jan - Okt 2026)",
                    "x_axis": "bulan",
                    "y_axis": "total_omset",
                    "data": chart_line_data,
                }),
                "tbl": json.dumps(table_line_data),
            },
        )

        # --- Widget 2: Doughnut Chart (Product Category Market Share) ---
        q_doughnut = """SELECT p.product_category_name AS kategori, SUM(oi.price) AS total_omset
FROM analytics.order_items oi
JOIN analytics.products p ON oi.product_id = p.product_id
JOIN analytics.orders o ON oi.order_id = o.order_id
WHERE o.order_status = 'delivered' AND p.product_category_name IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;"""

        res_doughnut = await session.execute(text(q_doughnut))
        rows_doughnut = res_doughnut.fetchall()
        chart_doughnut_data = [{"kategori": str(r[0]), "total_omset": float(r[1])} for r in rows_doughnut]
        table_doughnut_data = {"columns": ["kategori", "total_omset"], "rows": [[str(r[0]), float(r[1])] for r in rows_doughnut], "row_count": len(rows_doughnut)}

        await session.execute(
            text("""
                INSERT INTO analytics.dashboard_widgets (widget_id, session_id, widget_type, title, sql_query, chart_spec, table_data, created_at, updated_at)
                VALUES ('wgt_demo_doughnut', :sid, 'chart', 'Pangsa Pasar & Kontribusi Omset per Kategori Produk', :sql, :chart, :tbl, '2026-10-26 10:02:00', CURRENT_TIMESTAMP);
            """),
            {
                "sid": DEMO_SESSION_ID,
                "sql": q_doughnut,
                "chart": json.dumps({
                    "chart_type": "doughnut",
                    "title": "Pangsa Pasar & Kontribusi Omset per Kategori Produk",
                    "x_axis": "kategori",
                    "y_axis": "total_omset",
                    "data": chart_doughnut_data,
                }),
                "tbl": json.dumps(table_doughnut_data),
            },
        )

        # --- Widget 3: Bar Chart (Orders by Region / Province) ---
        q_bar = """SELECT c.state AS provinsi, COUNT(DISTINCT o.order_id) AS jumlah_pesanan
FROM analytics.orders o
JOIN analytics.customers c ON o.customer_id = c.customer_id
WHERE o.order_status = 'delivered'
GROUP BY 1 ORDER BY 2 DESC LIMIT 6;"""

        res_bar = await session.execute(text(q_bar))
        rows_bar = res_bar.fetchall()
        chart_bar_data = [{"provinsi": str(r[0]), "jumlah_pesanan": int(r[1])} for r in rows_bar]
        table_bar_data = {"columns": ["provinsi", "jumlah_pesanan"], "rows": [[str(r[0]), int(r[1])] for r in rows_bar], "row_count": len(rows_bar)}

        await session.execute(
            text("""
                INSERT INTO analytics.dashboard_widgets (widget_id, session_id, widget_type, title, sql_query, chart_spec, table_data, created_at, updated_at)
                VALUES ('wgt_demo_bar', :sid, 'chart', 'Sebaran Volume Pesanan Selesai per Provinsi Utama', :sql, :chart, :tbl, '2026-10-26 10:03:00', CURRENT_TIMESTAMP);
            """),
            {
                "sid": DEMO_SESSION_ID,
                "sql": q_bar,
                "chart": json.dumps({
                    "chart_type": "bar",
                    "title": "Sebaran Volume Pesanan Selesai per Provinsi Utama",
                    "x_axis": "provinsi",
                    "y_axis": "jumlah_pesanan",
                    "data": chart_bar_data,
                }),
                "tbl": json.dumps(table_bar_data),
            },
        )

        # --- Widget 4: Pie Chart (Digital Payment Adoption) ---
        q_pie = """SELECT 
    CASE 
        WHEN payment_type = 'e_wallet' THEN 'E-Wallet / QRIS'
        WHEN payment_type = 'bank_transfer' THEN 'Virtual Account'
        WHEN payment_type = 'credit_card' THEN 'Kartu Kredit'
        ELSE 'Voucher / PayLater'
    END AS metode_pembayaran,
    COUNT(*) AS total_transaksi
FROM analytics.order_payments
GROUP BY 1 ORDER BY 2 DESC;"""

        res_pie = await session.execute(text(q_pie))
        rows_pie = res_pie.fetchall()
        chart_pie_data = [{"metode_pembayaran": str(r[0]), "total_transaksi": int(r[1])} for r in rows_pie]
        table_pie_data = {"columns": ["metode_pembayaran", "total_transaksi"], "rows": [[str(r[0]), int(r[1])] for r in rows_pie], "row_count": len(rows_pie)}

        await session.execute(
            text("""
                INSERT INTO analytics.dashboard_widgets (widget_id, session_id, widget_type, title, sql_query, chart_spec, table_data, created_at, updated_at)
                VALUES ('wgt_demo_pie', :sid, 'chart', 'Distribusi Adopsi Metode Pembayaran Pelanggan', :sql, :chart, :tbl, '2026-10-26 10:04:00', CURRENT_TIMESTAMP);
            """),
            {
                "sid": DEMO_SESSION_ID,
                "sql": q_pie,
                "chart": json.dumps({
                    "chart_type": "pie",
                    "title": "Distribusi Adopsi Metode Pembayaran Pelanggan",
                    "x_axis": "metode_pembayaran",
                    "y_axis": "total_transaksi",
                    "data": chart_pie_data,
                }),
                "tbl": json.dumps(table_pie_data),
            },
        )

        # --- Widget 5: Interactive Table (Top 5 Best-Selling Products) ---
        q_tbl = """SELECT 
    p.product_category_name AS kategori,
    COUNT(oi.order_item_id) AS unit_terjual,
    ROUND(SUM(oi.price), 0) AS total_omset,
    ROUND(AVG(oi.price), 0) AS rata_rata_harga
FROM analytics.order_items oi
JOIN analytics.products p ON oi.product_id = p.product_id
JOIN analytics.orders o ON oi.order_id = o.order_id
WHERE o.order_status = 'delivered' AND p.product_category_name IS NOT NULL
GROUP BY p.product_category_name
ORDER BY total_omset DESC LIMIT 5;"""

        res_tbl = await session.execute(text(q_tbl))
        rows_tbl = res_tbl.fetchall()
        table_top_data = {
            "columns": ["kategori", "unit_terjual", "total_omset", "rata_rata_harga"],
            "rows": [[str(r[0]), int(r[1]), float(r[2]), float(r[3])] for r in rows_tbl],
            "row_count": len(rows_tbl),
        }

        await session.execute(
            text("""
                INSERT INTO analytics.dashboard_widgets (widget_id, session_id, widget_type, title, sql_query, chart_spec, table_data, created_at, updated_at)
                VALUES ('wgt_demo_table', :sid, 'table', 'Top 5 Kategori Produk Terlaris Berdasarkan Perolehan Omset', :sql, NULL, :tbl, '2026-10-26 10:05:00', CURRENT_TIMESTAMP);
            """),
            {
                "sid": DEMO_SESSION_ID,
                "sql": q_tbl,
                "tbl": json.dumps(table_top_data),
            },
        )

        # 6. Seed Interactive Chat Turns in analytics.agent_tasks
        logger.info("Seeding conversational turns into analytics.agent_tasks...")
        await session.execute(
            text("DELETE FROM analytics.agent_tasks WHERE session_id = :sid;"),
            {"sid": DEMO_SESSION_ID},
        )

        # Turn 1
        await session.execute(
            text("""
                INSERT INTO analytics.agent_tasks (
                    task_id, session_id, status, current_step, max_steps, user_query, messages, final_result, analyst_provider, analyst_model, created_at, updated_at
                ) VALUES (
                    'task_demo_01', :sid, 'COMPLETED', 2, 10,
                    'Bagaimana tren pertumbuhan pendapatan bulanan sepanjang tahun 2026?',
                    '[]'::jsonb,
                    :res, 'groq', 'openai/gpt-oss-120b', '2026-10-26 10:01:00', '2026-10-26 10:01:05'
                );
            """),
            {
                "sid": DEMO_SESSION_ID,
                "res": json.dumps({
                    "answer_text": "Sepanjang tahun 2026 (Januari hingga Oktober), performa pendapatan bisnis menunjukkan tren pertumbuhan konsisten. Puncak omset tertinggi terjadi pada **April 2026 (mencapai lebih dari Rp 45 Juta)** akibat lonjakan belanja musiman Ramadan & Idul Fitri, disusul momentum stabil di atas Rp 30 Juta/bulan pada festival belanja tengah tahun (Juni 6.6) dan Harbolnas kuartal ketiga.",
                    "sql_queries": [q_line],
                    "tables": [table_line_data],
                    "charts": [{
                        "chart_type": "line",
                        "title": "Tren Pertumbuhan Pendapatan Bulanan (Jan - Okt 2026)",
                        "x_axis": "bulan",
                        "y_axis": "total_omset",
                        "data": chart_line_data,
                    }],
                    "citations": ["analytics.orders", "analytics.order_items"],
                    "follow_up_suggestions": [
                        "Bagaimana komposisi omset per kategori produk?",
                        "Wilayah provinsi mana yang memberikan volume pesanan terbanyak?",
                        "Berapa rata-rata skor kepuasan ulasan pelanggan?"
                    ],
                    "audit_result": {
                        "status": "PASSED",
                        "confidence": 0.98,
                        "badge": "Verified by Auditor",
                        "critique": "Logika kueri valid (agregasi order delivered tepat, join antar-tabel konsisten tanpa Cartesian trap)."
                    },
                    "metrics": {"total_latency_ms": 1150, "ttft_ms": 420, "total_tokens": 890}
                }),
            },
        )

        # Turn 2
        await session.execute(
            text("""
                INSERT INTO analytics.agent_tasks (
                    task_id, session_id, status, current_step, max_steps, user_query, messages, final_result, analyst_provider, analyst_model, created_at, updated_at
                ) VALUES (
                    'task_demo_02', :sid, 'COMPLETED', 2, 10,
                    'Tampilkan kontribusi omset per kategori produk',
                    '[]'::jsonb,
                    :res, 'groq', 'openai/gpt-oss-120b', '2026-10-26 10:02:00', '2026-10-26 10:02:05'
                );
            """),
            {
                "sid": DEMO_SESSION_ID,
                "res": json.dumps({
                    "answer_text": "Kategori **Electronics** mendominasi perolehan pendapatan dengan kontribusi hampir 50% dari total omset nasional, diikuti oleh **Fashion** dan **Home & Living**. Produk gawai dan perlengkapan kerja modern memiliki kontribusi margin tertinggi.",
                    "sql_queries": [q_doughnut],
                    "tables": [table_doughnut_data],
                    "charts": [{
                        "chart_type": "doughnut",
                        "title": "Pangsa Pasar & Kontribusi Omset per Kategori Produk",
                        "x_axis": "kategori",
                        "y_axis": "total_omset",
                        "data": chart_doughnut_data,
                    }],
                    "citations": ["analytics.products", "analytics.order_items"],
                    "follow_up_suggestions": [
                        "Tampilkan sebaran pelanggan per provinsi",
                        "Apa saja 5 produk terlaris sepanjang tahun 2026?",
                        "Metode pembayaran apa yang paling populer?"
                    ],
                    "audit_result": {
                        "status": "PASSED",
                        "confidence": 0.97,
                        "badge": "Verified by Auditor",
                        "critique": "Verifikasi numerik cocok persis dengan tabel master produk dan transaksi."
                    },
                    "metrics": {"total_latency_ms": 980, "ttft_ms": 380, "total_tokens": 760}
                }),
            },
        )

        # Turn 3
        await session.execute(
            text("""
                INSERT INTO analytics.agent_tasks (
                    task_id, session_id, status, current_step, max_steps, user_query, messages, final_result, analyst_provider, analyst_model, created_at, updated_at
                ) VALUES (
                    'task_demo_03', :sid, 'COMPLETED', 2, 10,
                    'Bagaimana sebaran pesanan per provinsi dan preferensi metode pembayaran pelanggan?',
                    '[]'::jsonb,
                    :res, 'groq', 'openai/gpt-oss-120b', '2026-10-26 10:03:00', '2026-10-26 10:03:06'
                );
            """),
            {
                "sid": DEMO_SESSION_ID,
                "res": json.dumps({
                    "answer_text": "Secara geografis, **DKI Jakarta dan Jawa Barat** menjadi pusat volume transaksi terbesar (menyumbang lebih dari 55% pesanan delivered nasional). Dari sisi keuangan, pelanggan bertransaksi secara digital-first di mana **E-Wallet/QRIS (42%)** dan **Virtual Account Bank (35%)** menguasai lebih dari 75% seluruh transaksi.",
                    "sql_queries": [q_bar, q_pie],
                    "tables": [table_bar_data, table_pie_data],
                    "charts": [
                        {
                            "chart_type": "bar",
                            "title": "Sebaran Volume Pesanan Selesai per Provinsi Utama",
                            "x_axis": "provinsi",
                            "y_axis": "jumlah_pesanan",
                            "data": chart_bar_data,
                        },
                        {
                            "chart_type": "pie",
                            "title": "Distribusi Adopsi Metode Pembayaran Pelanggan",
                            "x_axis": "metode_pembayaran",
                            "y_axis": "total_transaksi",
                            "data": chart_pie_data,
                        }
                    ],
                    "citations": ["analytics.orders", "analytics.customers", "analytics.order_payments"],
                    "follow_up_suggestions": [
                        "Tampilkan tabel detail produk paling laris",
                        "Berapa rata-rata kepuasan review score pelanggan?",
                        "Ekspor seluruh temuan ini ke laporan resmi PDF"
                    ],
                    "audit_result": {
                        "status": "PASSED",
                        "confidence": 0.99,
                        "badge": "Verified by Auditor",
                        "critique": "Verifikasi multi-tabel berhasil. Angka pesanan dan transaksi pembayaran tervalidasi 100% konsisten."
                    },
                    "metrics": {"total_latency_ms": 1340, "ttft_ms": 450, "total_tokens": 1120}
                }),
            },
        )

        # Turn 4
        await session.execute(
            text("""
                INSERT INTO analytics.agent_tasks (
                    task_id, session_id, status, current_step, max_steps, user_query, messages, final_result, analyst_provider, analyst_model, created_at, updated_at
                ) VALUES (
                    'task_demo_04', :sid, 'COMPLETED', 2, 10,
                    'Tampilkan 5 kategori produk terlaris beserta performa omsetnya',
                    '[]'::jsonb,
                    :res, 'groq', 'openai/gpt-oss-120b', '2026-10-26 10:04:00', '2026-10-26 10:04:05'
                );
            """),
            {
                "sid": DEMO_SESSION_ID,
                "res": json.dumps({
                    "answer_text": "Berikut daftar 5 kategori produk teratas berdasarkan akumulasi unit terjual dan perolehan omset sepanjang tahun 2026. Seluruh data ini telah disematkan ke kanvas Live BI Dashboard untuk pemantauan eksekutif.",
                    "sql_queries": [q_tbl],
                    "tables": [table_top_data],
                    "charts": [],
                    "citations": ["analytics.order_items", "analytics.products", "analytics.orders"],
                    "follow_up_suggestions": [
                        "Bagaimana tren pertumbuhan per kuartal?",
                        "Apakah ada produk dengan ulasan negatif?",
                        "Ekspor laporan ini ke format PDF dan CSV"
                    ],
                    "audit_result": {
                        "status": "PASSED",
                        "confidence": 0.98,
                        "badge": "Verified by Auditor",
                        "critique": "Data tabular teragregasi dengan benar."
                    },
                    "metrics": {"total_latency_ms": 890, "ttft_ms": 310, "total_tokens": 640}
                }),
            },
        )

        await session.commit()
        logger.info("SHOWCASE MIGRATION & STORYTELLING SEED SUCCESSFULLY COMPLETED! 🚀")


if __name__ == "__main__":
    asyncio.run(migrate_and_seed_data())
