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
-- Delta-sync uchun. `products_shop_idx` qisman (WHERE is_active), shuning
-- uchun arxivlanganlarni ham qamrashi kerak bo'lgan sync so'roviga yaramaydi.
CREATE INDEX IF NOT EXISTS products_shop_updated_idx ON products(shop_id, updated_at);
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
-- Mijoz sahifasidagi "Xaridlari" bo'limi shu bo'yicha sahifalab o'qiydi.
CREATE INDEX IF NOT EXISTS sales_customer_idx  ON sales(customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Yumshoq o'chirish. Chiqimda stock_moves kabi jurnal yo'q, shuning uchun
  -- qattiq DELETE qaytarib bo'lmasdi. Ayni vaqtda bu ustun mijoz cache'i
  -- uchun "tombstone" vazifasini ham bajaradi.
  deleted_at timestamptz
);
-- Mavjud bazalar uchun (CREATE TABLE yuqorida IF NOT EXISTS bilan o'tkazib
-- yuboriladi, shuning uchun yangi ustunlar alohida qo'shiladi).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS expenses_shop_date_idx ON expenses(shop_id, created_at DESC);

-- ---------- Mutatsiya jurnali (offline navbat uchun) ----------
--
-- MUAMMO: internet yo'q bo'lganda ilova savdoni navbatga qo'yadi va keyin
-- yuboradi. Yuborish yarim yo'lda uzilsa (server yozdi, javob yetib
-- kelmadi) mijoz qayta urinadi — va savdo IKKI MARTA yoziladi, qoldiq
-- ikki marta kamayadi.
--
-- YECHIM: mijoz har bir o'zgarishga o'zi uuid beradi. Server uni shu
-- jadvalga yozadi; ikkinchi marta kelganda amal qayta bajarilmaydi,
-- saqlangan natija qaytariladi.
--
-- Jadval o'sib boradi (bir yozuv ~200 bayt). Kerak bo'lsa eskilarini
-- vaqti-vaqti bilan tozalash mumkin — mijoz bir necha kundan keyin
-- baribir qayta yubormaydi.
CREATE TABLE IF NOT EXISTS mutation_log (
  client_mutation_id uuid PRIMARY KEY,
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  kind       text NOT NULL,
  result     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mutation_log_shop_idx ON mutation_log(shop_id, created_at DESC);

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

-- Kunlik kirim / chiqim / foyda — `daily_summary`
--
-- Ta'rifi ATAYLAB shu yerda emas, `004-tezlik.sql` da: u yerda ko'rinish
-- tezlik uchun qayta yozilgan. Ikki joyda ikki xil ta'rif tursa, ustun
-- qo'shish imkonsiz bo'lardi — CREATE OR REPLACE ustunni olib tashlashga
-- ruxsat bermaydi va migratsiya har safar yiqilardi.
