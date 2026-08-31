-- ============================================================
--  AQLLI QIDIRUV
--  Do'konchi nomni xato yozishi, so'zlarni tashlab ketishi yoki
--  faqat ikkinchi so'zini yozishi mumkin. Shu holatlarni qoplaymiz.
--
--  Bu mantiq ataylab BAZADA turadi: REST marshruti ham, AI vositasi ham
--  aynan bir xil natija bersin. Ikki joyda ikki xil qidiruv bo'lsa,
--  AI bir narsani, ekran boshqa narsani ko'rsatib qolardi.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;   -- levenshtein
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Normalizatsiya ----------
-- "O'simlik yog'i 1L"  →  "osimlik yogi 1.l"
-- "Coca-Cola 1.5L"     →  "coca cola 1.5l"
-- "Пиёз"               →  "piyoz"
CREATE OR REPLACE FUNCTION dokon_norm(t text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    translate(
      -- 2. Bir harfli kirill → lotin
      translate(
        -- 1. Ko'p harfli kirill birikmalari (translate 1:1 ishlaydi, shuning uchun alohida)
        replace(replace(replace(replace(replace(replace(
          -- 0. Apostroflar butunlay O'CHIRILADI (bo'sh joyga emas!):
          --    o'simlik → osimlik, yog'i → yogi.
          --    Bo'sh joyga almashtirilsa "o simlik" bo'lib, so'z ikkiga bo'linardi.
          translate(lower(coalesce(t, '')), E'ʻʼ‘’`\'\u02BC\u2019', ''),
          'ё', 'yo'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'), 'ю', 'yu'), 'я', 'ya'),
        'абвгдежзийклмнопрстуфхъыьэўқғҳ',
        'abvgdejzijklmnoprstufx  ie oqgh'
      ),
      -- 4. Tinish belgilari bo'sh joyga: Coca-Cola → coca cola
      -- Nuqta ATAYLAB qoldirilgan: "1.5L" bir bo'lak bo'lib qolsin,
      -- aks holda "1" va "5l" ga bo'linib, o'lcham ma'nosi yo'qoladi.
      E'-–—(),/[]_+*"',
      '               '
    ),
  '\s+', ' ', 'g'))
$$;

-- ---------- Bitta nom bilan so'rovning mosligi: 0..1 ----------
CREATE OR REPLACE FUNCTION dokon_match_score(p_name text, p_query text)
RETURNS real LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  n      text := dokon_norm(p_name);
  q      text := dokon_norm(p_query);
  ntoks  text[];
  qtoks  text[];
  tok    text;
  nt     text;
  best   real;
  total  real := 0;
  cnt    int  := 0;
  thr    int;
  d      int;
BEGIN
  IF q = '' OR n = '' THEN RETURN 0; END IF;

  -- Aniq mosliklar — eng yuqori ball
  IF n = q                     THEN RETURN 1.0;  END IF;
  IF n LIKE q || '%'           THEN RETURN 0.95; END IF;
  IF position(q in n) > 0      THEN RETURN 0.90; END IF;

  ntoks := string_to_array(n, ' ');
  qtoks := string_to_array(q, ' ');

  -- So'rovdagi HAR BIR so'z uchun nomdagi eng mos so'zni qidiramiz.
  -- Shu sabab "kir kukuni" → "Kir yuvish kukuni" topiladi (o'rtadagi so'z tashlansa ham),
  -- va "lazer" → "Guruch Lazer 1kg" (faqat ikkinchi so'z yozilsa ham).
  FOREACH tok IN ARRAY qtoks LOOP
    CONTINUE WHEN tok = '';
    cnt  := cnt + 1;
    best := 0;

    FOREACH nt IN ARRAY ntoks LOOP
      CONTINUE WHEN nt = '';
      IF    nt = tok                  THEN best := GREATEST(best, 1.00);
      ELSIF nt LIKE tok || '%'        THEN best := GREATEST(best, 0.90);
      ELSIF position(tok in nt) > 0   THEN best := GREATEST(best, 0.75);
      ELSE
        -- Xato yozilgan so'z: ruxsat etilgan xatolar soni so'z uzunligiga bog'liq.
        -- Qisqa so'zda 1 xato ham ma'noni butunlay o'zgartiradi.
        thr := CASE WHEN length(tok) <= 3 THEN 1
                    WHEN length(tok) <= 7 THEN 2
                    ELSE 3 END;
        d := levenshtein(tok, nt);
        IF d <= thr THEN
          best := GREATEST(best, 0.72 - 0.08 * d);
        END IF;
      END IF;
    END LOOP;

    total := total + best;
  END LOOP;

  IF cnt = 0 THEN RETURN 0; END IF;

  -- O'rtacha: bitta so'z mos kelmasa ball keskin tushadi.
  -- 0.85 koeffitsiyenti — aniq moslik (0.90+) doim yuqorida tursin.
  RETURN (total / cnt) * 0.85;
END;
$$;

-- ---------- Mahsulot qidirish ----------
-- Eslatma: ball har bir qatorga hisoblanadi (indeks bo'yicha emas).
-- Bitta do'konda minglab mahsulot bo'lsa ham bu bir necha millisekund.
--
-- DROP kerak: 003-search-staged.sql shu funksiyani BOSHQA ustunlar bilan
-- (`taxminiy` qo'shilgan) qayta yaratadi. Migratsiya qayta ishga tushganda
-- CREATE OR REPLACE "cannot change return type" deb yiqilardi.
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
  barcode text, photo_url text, category text, score real
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, p.unit, p.cost_price, p.sale_price,
         p.stock, p.min_stock, p.barcode, p.photo_url, c.name,
         CASE WHEN p.barcode IS NOT NULL AND p.barcode = btrim(p_query)
              THEN 1.0::real
              ELSE dokon_match_score(p.name, p_query) END AS score
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
   WHERE p.shop_id = p_shop AND p.is_active
     AND (
       (p.barcode IS NOT NULL AND p.barcode = btrim(p_query))
       OR dokon_match_score(p.name, p_query) >= p_min
     )
   ORDER BY score DESC, length(p.name), p.name
   LIMIT p_limit
$$;

-- ---------- Mijoz qidirish ----------
-- Ism ham xato yozilishi mumkin: "Alsiher" → "Alisher Karimov"
-- (DROP sababi yuqoridagi bilan bir xil.)
DROP FUNCTION IF EXISTS dokon_search_customers(uuid, text, int, real);
CREATE FUNCTION dokon_search_customers(
  p_shop  uuid,
  p_query text,
  p_limit int  DEFAULT 20,
  p_min   real DEFAULT 0.3
)
RETURNS TABLE (
  id uuid, name text, phone text,
  balance numeric, nearest_due date, score real
)
LANGUAGE sql STABLE AS $$
  SELECT cb.customer_id, cb.name, cb.phone, cb.balance, cb.nearest_due,
         dokon_match_score(cb.name, p_query) AS score
    FROM customer_balances cb
   WHERE cb.shop_id = p_shop
     AND dokon_match_score(cb.name, p_query) >= p_min
   ORDER BY score DESC, cb.name
   LIMIT p_limit
$$;

-- Normalizatsiyalangan nom bo'yicha trigram indeksi —
-- katalog kattalashganda oldindan saralash uchun foydali.
CREATE INDEX IF NOT EXISTS products_norm_trgm
  ON products USING gin (dokon_norm(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_norm_trgm
  ON customers USING gin (dokon_norm(name) gin_trgm_ops);
