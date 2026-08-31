-- ============================================================
--  DO'KON CRM  —  Postgres sxemasi
--  Barcha pul maydonlari numeric(14,2) — so'm uchun.
--  Miqdor numeric(14,3) — kg/litr/metr kasrli bo'lishi mumkin.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- nomlarni "taxminan" qidirish uchun

-- ---------- ENUM'lar ----------
DO $$ BEGIN
  CREATE TYPE unit_t AS ENUM ('dona','kg','gram','litr','metr','quti','pachka');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_t AS ENUM ('naqd','karta','qarz','aralash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE move_t AS ENUM ('kirim','chiqim','tuzatish');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE role_t AS ENUM ('owner','seller');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Do'kon (tenant) ----------
CREATE TABLE IF NOT EXISTS shops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  currency    text NOT NULL DEFAULT 'UZS',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Foydalanuvchilar ----------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  phone         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          role_t NOT NULL DEFAULT 'seller',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Kategoriyalar ----------
CREATE TABLE IF NOT EXISTS categories (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id  uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name     text NOT NULL,
  UNIQUE (shop_id, name)
);

-- ---------- Mahsulotlar ----------
CREATE TABLE IF NOT EXISTS products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name         text NOT NULL,
  barcode      text,
  category_id  uuid REFERENCES categories(id) ON DELETE SET NULL,
  unit         unit_t NOT NULL DEFAULT 'dona',
  cost_price   numeric(14,2) NOT NULL DEFAULT 0,   -- tan narx
  sale_price   numeric(14,2) NOT NULL DEFAULT 0,   -- sotuv narxi
  stock        numeric(14,3) NOT NULL DEFAULT 0,   -- ombordagi qoldiq
  min_stock    numeric(14,3) NOT NULL DEFAULT 0,   -- ogohlantirish chegarasi
  photo_url    text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_shop_idx    ON products(shop_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products(shop_id, barcode);
-- Nomi bo'yicha tez va "xato yozilgan" qidiruv uchun (piyoz / piyoz. / Piyoz)
CREATE INDEX IF NOT EXISTS products_name_trgm   ON products USING gin (lower(name) gin_trgm_ops);

-- ---------- Mijozlar ----------
CREATE TABLE IF NOT EXISTS customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       text NOT NULL,
  phone      text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_shop_idx  ON customers(shop_id);
CREATE INDEX IF NOT EXISTS customers_name_trgm ON customers USING gin (lower(name) gin_trgm_ops);

-- ---------- Savdo ----------
CREATE TABLE IF NOT EXISTS sales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  total          numeric(14,2) NOT NULL DEFAULT 0,  -- umumiy summa
  cost_total     numeric(14,2) NOT NULL DEFAULT 0,  -- tan narx jami (foyda uchun)
  paid           numeric(14,2) NOT NULL DEFAULT 0,  -- naqd/karta tushgan qism
  payment_method payment_t NOT NULL DEFAULT 'naqd',
  note           text,
  source         text NOT NULL DEFAULT 'manual',    -- manual | ai
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_shop_date_idx ON sales(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name_snap  text NOT NULL,                       -- mahsulot o'chirilsa ham nomi qoladi
  unit       unit_t NOT NULL,
  qty        numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL,
  cost_price numeric(14,2) NOT NULL DEFAULT 0,
  subtotal   numeric(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items(sale_id);

-- ---------- Omborga kirim (yetkazib beruvchidan) ----------
CREATE TABLE IF NOT EXISTS purchases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  supplier   text,
  total      numeric(14,2) NOT NULL DEFAULT 0,
  note       text,
  source     text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_shop_date_idx ON purchases(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  name_snap   text NOT NULL,
  unit        unit_t NOT NULL,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  cost_price  numeric(14,2) NOT NULL,
  subtotal    numeric(14,2) NOT NULL
);

-- ---------- Ombor harakatlari (audit trail) ----------
-- Har bir qoldiq o'zgarishi shu yerga yoziladi — "qoldiq nega bunday?" savoliga javob.
CREATE TABLE IF NOT EXISTS stock_moves (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type       move_t NOT NULL,
  qty        numeric(14,3) NOT NULL,        -- musbat son, yo'nalish `type` da
  stock_after numeric(14,3) NOT NULL,
  ref_type   text,                          -- sale | purchase | manual | qaytarish
  ref_id     uuid,
  note       text,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_moves_prod_idx ON stock_moves(product_id, created_at DESC);

-- ---------- Qarz daftari ----------
-- amount > 0  => mijozga qarz berildi (u bizga qarzdor bo'ldi)
-- amount < 0  => mijoz qarzini to'ladi
CREATE TABLE IF NOT EXISTS debts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id     uuid REFERENCES sales(id) ON DELETE SET NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount <> 0),
  due_date    date,
  note        text,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  source      text NOT NULL DEFAULT 'manual',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debts_customer_idx ON debts(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS debts_shop_idx     ON debts(shop_id, created_at DESC);

-- ---------- Chiqimlar ----------
CREATE TABLE IF NOT EXISTS expenses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  category   text NOT NULL DEFAULT 'boshqa',   -- ijara, transport, oylik, ...
  amount     numeric(14,2) NOT NULL CHECK (amount > 0),
  note       text,
  source     text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_shop_date_idx ON expenses(shop_id, created_at DESC);

-- ---------- AI jurnali ----------
CREATE TABLE IF NOT EXISTS ai_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  kind       text NOT NULL,          -- command | vision | insight
  input      text,
  actions    jsonb,
  summary    text,
  executed   boolean NOT NULL DEFAULT false,
  tokens_in  integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Ko'rinishlar (hisobot uchun) ----------

-- Mijozlarning joriy qarzi
CREATE OR REPLACE VIEW customer_balances AS
SELECT c.id           AS customer_id,
       c.shop_id,
       c.name,
       c.phone,
       COALESCE(SUM(d.amount), 0)                  AS balance,      -- qancha qarzdor
       MIN(d.due_date) FILTER (WHERE d.amount > 0) AS nearest_due,
       MAX(d.created_at)                           AS last_activity
FROM customers c
LEFT JOIN debts d ON d.customer_id = c.id
GROUP BY c.id, c.shop_id, c.name, c.phone;

-- Kunlik kirim / chiqim / foyda
CREATE OR REPLACE VIEW daily_summary AS
WITH s AS (
  SELECT shop_id, (created_at AT TIME ZONE 'Asia/Tashkent')::date AS d,
         SUM(total) AS sales_total, SUM(paid) AS cash_in,
         SUM(total - cost_total) AS gross_profit, COUNT(*) AS sales_count
  FROM sales GROUP BY 1, 2
), e AS (
  SELECT shop_id, (created_at AT TIME ZONE 'Asia/Tashkent')::date AS d,
         SUM(amount) AS expense_total
  FROM expenses GROUP BY 1, 2
), p AS (
  SELECT shop_id, (created_at AT TIME ZONE 'Asia/Tashkent')::date AS d,
         SUM(-amount) AS debt_paid          -- to'langan qarz = kirim
  FROM debts WHERE amount < 0 GROUP BY 1, 2
)
SELECT COALESCE(s.shop_id, e.shop_id, p.shop_id) AS shop_id,
       COALESCE(s.d, e.d, p.d)                   AS day,
       COALESCE(s.sales_total, 0)                AS sales_total,
       COALESCE(s.cash_in, 0) + COALESCE(p.debt_paid, 0) AS cash_in,
       COALESCE(e.expense_total, 0)              AS expense_total,
       COALESCE(s.gross_profit, 0) - COALESCE(e.expense_total, 0) AS net_profit,
       COALESCE(s.sales_count, 0)                AS sales_count
FROM s FULL JOIN e ON s.shop_id = e.shop_id AND s.d = e.d
       FULL JOIN p ON COALESCE(s.shop_id, e.shop_id) = p.shop_id
                  AND COALESCE(s.d, e.d) = p.d;
