-- ============================================================
--  BIR MAHSULOTGA BIR NECHTA SHTRIX-KOD
--
--  MUAMMO. `products.barcode` bitta ustun edi. Lekin ayni mahsulot
--  do'konga har xil kod bilan keladi: "Fanta 1L" ning eski va yangi
--  partiyasi, boshqa zavod, boshqa mamlakat uchun qadoq — kod boshqa.
--  Do'konchi ulardan FAQAT BITTASINI saqlay olardi, qolganini skanerlasa
--  "topilmadi" chiqardi va kassada nomi bilan qidirishga majbur bo'lardi.
--
--  MODEL. `products.barcode` — ASOSIY kod (o'zgarmadi, mavjud kod
--  hammasi ishlayveradi). Bu jadval — QO'SHIMCHA kodlar. Ilova ikkalasini
--  birlashtirib, bitta ro'yxat qilib ko'rsatadi.
--
--  Nega asosiy kod ko'chirilmadi: uni `products` dan olib tashlash
--  qidiruv funksiyalari, sync, `lib/actions.ts` va mobil keshni bir
--  vaqtda o'zgartirishni talab qilardi. Bitta ustunni ikki joyda
--  saqlashdan ko'ra, "asosiy + qo'shimcha" modeli oddiyroq va xavfsiz.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_barcodes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Bitta kod bitta do'konda faqat bitta mahsulotni bildiradi.
  -- Busiz kassada skaner ikki xil javob berardi va qaysi biri to'g'ri
  -- ekanini hech kim ayta olmasdi.
  UNIQUE (shop_id, code)
);

CREATE INDEX IF NOT EXISTS product_barcodes_product_idx
  ON product_barcodes(product_id);

-- ---------- Mahsulotning BARCHA kodlari ----------
-- Asosiy birinchi, qo'shimchalar qo'shilgan tartibda.
-- Bir joyda: REST marshruti, sync va qidiruv aynan shu funksiyani
-- ishlatadi — ro'yxat uch joyda uch xil bo'lib qolmasin.
CREATE OR REPLACE FUNCTION dokon_barcodes(p_product uuid, p_asosiy text)
RETURNS text[] LANGUAGE sql STABLE PARALLEL SAFE AS $$
  -- GROUP BY — takrorni yig'ishtiradi. Asosiy kod ayni paytda qo'shimcha
  -- ro'yxatida ham turishi mumkin: do'konchi tahrirlashda asosiy kodni
  -- mahsulotning o'z qo'shimcha kodiga almashtirsa shunday bo'ladi.
  -- `min(ord)` esa asosiy kodni birinchi o'rinda qoldiradi.
  SELECT COALESCE(array_agg(code ORDER BY ord, code), ARRAY[]::text[])
    FROM (
      SELECT code, min(ord) AS ord
        FROM (
          SELECT btrim(p_asosiy) AS code, 0 AS ord
           WHERE p_asosiy IS NOT NULL AND btrim(p_asosiy) <> ''
          UNION ALL
          SELECT b.code, 1
            FROM product_barcodes b
           WHERE b.product_id = p_product
        ) t
       GROUP BY code
    ) s
$$;

-- ---------- Qidiruvda qo'shimcha kodlar ----------
-- `dokon_search_products` ilgari faqat `p.barcode` ni tekshirardi.
-- Endi qo'shimcha kod ham aynan moslik (ball 1.0) beradi — skaner
-- yoki qo'lda yozilgan kod bo'yicha mahsulot topilsin.
DROP FUNCTION IF EXISTS dokon_search_products(uuid, text, int, real);
CREATE FUNCTION dokon_search_products(
  p_shop  uuid,
  p_query text,
  p_limit int  DEFAULT 20,
  p_min   real DEFAULT 0.3
)
RETURNS TABLE (
  id uuid, name text, unit unit_t,
  cost_price numeric, sale_price numeric,
  stock numeric, min_stock numeric,
  barcode text, photo_url text, category text,
  score real,
  taxminiy boolean
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  q text := btrim(p_query);
BEGIN
  -- 1-BOSQICH: shtrix-kod (asosiy YOKI qo'shimcha) yoki aniq nom mosligi
  RETURN QUERY
    SELECT p.id, p.name, p.unit, p.cost_price, p.sale_price,
           p.stock, p.min_stock, p.barcode, p.photo_url, c.name,
           CASE WHEN p.barcode = q
                  OR EXISTS (SELECT 1 FROM product_barcodes b
                              WHERE b.product_id = p.id AND b.code = q)
                THEN 1.0::real
                ELSE dokon_direct_score(p.name, p_query) END,
           false
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.shop_id = p_shop AND p.is_active
       AND (p.barcode = q
            OR EXISTS (SELECT 1 FROM product_barcodes b
                        WHERE b.product_id = p.id AND b.code = q)
            OR dokon_direct_score(p.name, p_query) >= p_min)
     ORDER BY 11 DESC, length(p.name), p.name
     LIMIT p_limit;

  IF FOUND THEN RETURN; END IF;

  -- 2-BOSQICH: hech narsa topilmadi — o'xshash NOMlarni qidiramiz.
  -- Shtrix-kodda "taxminiy" ma'nosi yo'q: kod yo to'g'ri, yo boshqa mahsulot.
  RETURN QUERY
    SELECT p.id, p.name, p.unit, p.cost_price, p.sale_price,
           p.stock, p.min_stock, p.barcode, p.photo_url, c.name,
           dokon_match_score(p.name, p_query),
           true
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.shop_id = p_shop AND p.is_active
       AND dokon_match_score(p.name, p_query) >= p_min
     ORDER BY 11 DESC, length(p.name), p.name
     LIMIT p_limit;
END;
$$;
