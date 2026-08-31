-- ============================================================
--  IKKI BOSQICHLI QIDIRUV
--
--  1-bosqich — ANIQ qidiruv: aynan moslik, boshlanishi, ichida borligi,
--              so'zlar bo'yicha moslik. Tez va shovqinsiz.
--  2-bosqich — faqat 1-bosqich HECH NARSA topmasa ishga tushadi:
--              xato yozilgan nomlarni Levenshtein bilan qidiradi.
--
--  Nega shunday? "sut" yozganda "Suv 5L" ni ko'rsatish shovqin — aniq
--  moslik bor ekan, taxminlarni aralashtirmaslik kerak. O'xshash variantlar
--  faqat hech narsa topilmaganda foydali bo'ladi.
-- ============================================================

-- ---------- 1-bosqich: aniq moslik (taxminsiz) ----------
CREATE OR REPLACE FUNCTION dokon_direct_score(p_name text, p_query text)
RETURNS real LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  n     text := dokon_norm(p_name);
  q     text := dokon_norm(p_query);
  ntoks text[];
  qtoks text[];
  tok   text;
  nt    text;
  best  real;
  total real := 0;
  cnt   int  := 0;
BEGIN
  IF q = '' OR n = '' THEN RETURN 0; END IF;

  IF n = q                THEN RETURN 1.00; END IF;
  IF n LIKE q || '%'      THEN RETURN 0.95; END IF;
  IF position(q in n) > 0 THEN RETURN 0.90; END IF;

  ntoks := string_to_array(n, ' ');
  qtoks := string_to_array(q, ' ');

  -- Har bir so'rov so'zi nomdagi biror so'zga MOS TUSHISHI shart.
  -- Bittasi ham mos kelmasa — bu aniq moslik emas, 0 qaytadi.
  FOREACH tok IN ARRAY qtoks LOOP
    CONTINUE WHEN tok = '';
    cnt  := cnt + 1;
    best := 0;
    FOREACH nt IN ARRAY ntoks LOOP
      CONTINUE WHEN nt = '';
      IF    nt = tok                THEN best := GREATEST(best, 1.00);
      ELSIF nt LIKE tok || '%'      THEN best := GREATEST(best, 0.90);
      ELSIF position(tok in nt) > 0 THEN best := GREATEST(best, 0.75);
      END IF;
    END LOOP;
    IF best = 0 THEN RETURN 0; END IF;   -- so'z topilmadi → aniq moslik yo'q
    total := total + best;
  END LOOP;

  IF cnt = 0 THEN RETURN 0; END IF;
  RETURN (total / cnt) * 0.85;
END;
$$;

-- ---------- Mahsulot qidirish (bosqichma-bosqich) ----------
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
  -- true bo'lsa: aniq moslik topilmadi, bu — taxminiy variant.
  -- Ilova buni "shunga o'xshashlar" deb ko'rsatadi.
  taxminiy boolean
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- 1-BOSQICH: shtrix-kod yoki aniq nom mosligi
  RETURN QUERY
    SELECT p.id, p.name, p.unit, p.cost_price, p.sale_price,
           p.stock, p.min_stock, p.barcode, p.photo_url, c.name,
           CASE WHEN p.barcode = btrim(p_query) THEN 1.0::real
                ELSE dokon_direct_score(p.name, p_query) END,
           false
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.shop_id = p_shop AND p.is_active
       AND (p.barcode = btrim(p_query)
            OR dokon_direct_score(p.name, p_query) >= p_min)
     ORDER BY 11 DESC, length(p.name), p.name
     LIMIT p_limit;

  IF FOUND THEN RETURN; END IF;

  -- 2-BOSQICH: hech narsa topilmadi — endi o'xshashlarini qidiramiz
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

-- ---------- Mijoz qidirish (xuddi shunday) ----------
DROP FUNCTION IF EXISTS dokon_search_customers(uuid, text, int, real);
CREATE FUNCTION dokon_search_customers(
  p_shop  uuid,
  p_query text,
  p_limit int  DEFAULT 20,
  p_min   real DEFAULT 0.3
)
RETURNS TABLE (
  id uuid, name text, phone text,
  balance numeric, nearest_due date,
  score real, taxminiy boolean
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
    SELECT cb.customer_id, cb.name, cb.phone, cb.balance, cb.nearest_due,
           dokon_direct_score(cb.name, p_query), false
      FROM customer_balances cb
     WHERE cb.shop_id = p_shop
       AND dokon_direct_score(cb.name, p_query) >= p_min
     ORDER BY 6 DESC, cb.name
     LIMIT p_limit;

  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT cb.customer_id, cb.name, cb.phone, cb.balance, cb.nearest_due,
           dokon_match_score(cb.name, p_query), true
      FROM customer_balances cb
     WHERE cb.shop_id = p_shop
       AND dokon_match_score(cb.name, p_query) >= p_min
     ORDER BY 6 DESC, cb.name
     LIMIT p_limit;
END;
$$;
