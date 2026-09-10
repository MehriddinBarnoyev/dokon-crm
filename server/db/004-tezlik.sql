-- ============================================================
--  TEZLIK
--
--  Muammo: `daily_summary` to'rtta agregatni FULL JOIN qilardi.
--  Postgres shartni FULL JOIN ostiga TUSHIRA OLMAYDI, shuning uchun
--  bosh sahifadagi "bugungi hisob" so'rovi ham `sales`, `expenses` va
--  `debts` jadvallarini BUTUNLAY, hamma do'kon bo'yicha skanerlardi.
--
--  Yechim: FULL JOIN o'rniga UNION ALL. Endi `shop_id` va `day`
--  guruhlash ustunlari bo'lgani uchun shart har bir bo'lakka tushadi
--  va quyidagi indekslardan foydalanadi.
--
--  Raqamlar O'ZGARMAYDI — mantiq aynan avvalgidek, faqat shakli boshqa.
-- ============================================================

-- ---------- Kun chegarasi ----------
-- `created_at AT TIME ZONE 'Asia/Tashkent'` STABLE hisoblanadi, shuning
-- uchun uni to'g'ridan-to'g'ri indeksga qo'yib bo'lmaydi. Bu o'ram esa
-- IMMUTABLE deb e'lon qilinadi.
--
-- XAVFSIZMI? Ha: indeks faqat ZONA TA'RIFI o'zgarsa buzilardi.
-- Asia/Tashkent 1992 yildan beri qat'iy UTC+5, yozgi vaqt yo'q.
CREATE OR REPLACE FUNCTION dokon_kun(t timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (t AT TIME ZONE 'Asia/Tashkent')::date
$$;

CREATE INDEX IF NOT EXISTS sales_shop_day_idx
  ON sales (shop_id, dokon_kun(created_at));

CREATE INDEX IF NOT EXISTS expenses_shop_day_idx
  ON expenses (shop_id, dokon_kun(created_at))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS debts_shop_day_idx
  ON debts (shop_id, dokon_kun(created_at));

-- ---------- Kunlik yakun ----------
--
-- FOYDA QACHON YOZILADI? Savdo BO'LGAN kuni — mijoz pulni keyin bersa ham.
-- Bu jahon amaliyotidagi asosiy qoida (accrual): daromad mol qo'ldan
-- chiqqanda tan olinadi, pul kelganda emas. Aks holda "qarzga sotgan kun"
-- foydasiz ko'rinardi va o'sha foyda mijoz to'lagan kunga sakrab, qaysi
-- mahsulot qancha foyda keltirgani umuman bilinmay qolardi.
--
-- Lekin do'konchiga bitta raqamning o'zi kam: "foyda bor, pul yo'q" holati
-- eng ko'p uchraydigan tuzoq. Shuning uchun yonida `credit_total` va
-- `credit_profit` ham chiqadi — o'sha foydaning qancha qismi hali qog'ozda,
-- ya'ni odamlarning cho'ntagida turgani.
CREATE OR REPLACE VIEW daily_summary AS
WITH faktlar AS (
  -- --- Savdo ---
  SELECT shop_id,
         dokon_kun(created_at)  AS day,
         total                  AS sales_total,
         paid                   AS cash_in,
         (total - cost_total)   AS gross_profit,
         1                      AS sales_count,
         -- O'sha kuni sotilgan, lekin puli olinmagan qism
         GREATEST(total - paid, 0) AS credit_total,
         -- Qarzda qolgan ULUSHga to'g'ri keladigan foyda.
         -- Yarmi to'langan savdoning foydasi ham yarmi qarzda hisoblanadi.
         (total - cost_total)
           * CASE WHEN total > 0 THEN GREATEST(total - paid, 0) / total
                  ELSE 0 END    AS credit_profit,
         0::numeric             AS expense_total,
         0::numeric             AS debt_paid,
         0::numeric             AS debt_given
    FROM sales

  UNION ALL

  -- --- Chiqim ---
  SELECT shop_id, dokon_kun(created_at),
         0, 0, 0, 0, 0, 0,
         amount,
         0, 0
    FROM expenses
   WHERE deleted_at IS NULL

  UNION ALL

  -- --- Qarz daftari ---
  -- Faqat yakunga ta'sir qiladigan qatorlar: to'lovlar (amount < 0) va
  -- QO'LDA berilgan qarz (`sale_id IS NULL`). Savdodan chiqqan qarz
  -- `credit_total` da allaqachon bor — ikki marta sanalmasin.
  SELECT shop_id, dokon_kun(created_at),
         0, 0, 0, 0, 0, 0, 0,
         -- to'langan qarz = kirim
         CASE WHEN amount < 0 THEN -amount ELSE 0 END,
         -- qo'lda berilgan qarz
         CASE WHEN amount > 0 AND sale_id IS NULL THEN amount ELSE 0 END
    FROM debts
   WHERE amount < 0 OR sale_id IS NULL
)
SELECT shop_id,
       day,
       SUM(sales_total)                   AS sales_total,
       SUM(cash_in) + SUM(debt_paid)      AS cash_in,
       SUM(expense_total)                 AS expense_total,
       SUM(gross_profit) - SUM(expense_total) AS net_profit,
       SUM(sales_count)                   AS sales_count,
       SUM(credit_total)                  AS credit_total,
       ROUND(SUM(credit_profit), 2)       AS credit_profit,
       -- Qo'lda berilgan qarz. Tushum va foydaga ta'sir qilmaydi (mol
       -- chiqmagan, tannarx yo'q) — lekin do'konchi kuni bilan qancha
       -- qarz tarqatganini ko'rishi kerak.
       SUM(debt_given)                    AS debt_given
  FROM faktlar
 GROUP BY shop_id, day;

-- ---------- Mutatsiya jurnalini tozalash ----------
-- `mutation_log` faqat "bu o'zgarish allaqachon bajarilgan" degan
-- darvoza uchun kerak. Mijoz bir necha kundan keyin baribir qayta
-- yubormaydi, shuning uchun eski yozuvlar faqat joy egallaydi.
-- Tozalash `src/lib/tozalash.ts` da, bu indeks esa unga kerak.
CREATE INDEX IF NOT EXISTS mutation_log_created_idx ON mutation_log(created_at);
