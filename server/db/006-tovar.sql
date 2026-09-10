-- ============================================================
--  TOVAR XARIDI — CHIQIM EMAS
--
--  MUAMMO. Do'konga mol olinganda uning puli `expenses` ga yozilardi,
--  chunki ilovada boshqa yo'l yo'q edi. Natijada o'sha pul foydadan
--  IKKI MARTA ayirilardi:
--
--     1) olingan kuni  — `expense_total` bo'lib
--     2) sotilgan kuni — `cost_total` (tan narx) bo'lib
--
--  Ustiga ombor qoldig'i ham oshmasdi: 10 ta non kelgani bilan ilova
--  eski raqamni ko'rsatib turardi.
--
--  TO'G'RI QOIDA (accrual). Mol sotib olish — xarajat emas, pulning
--  TOVARGA aylanishi. Xarajatga u faqat SOTILGANDA aylanadi, ya'ni
--  tan narx bo'lib. Shuning uchun `purchases` foydadan ayirilmaydi.
--
--  LEKIN pul kassadan chiqqan va do'konchi buni ko'rishi kerak —
--  aks holda "pulim qayerga ketdi?" degan savol tug'iladi. Shuning
--  uchun `purchase_total` alohida ustun: hisobotda ko'rinadi, foydaga
--  tegmaydi.
--
--  `net_profit` FORMULASI O'ZGARMAYDI:
--     Savdo − Tan narx = Yalpi foyda
--     Yalpi foyda − Chiqim = Sof foyda
--  O'zgarishi kerak bo'lgani — tovar xaridining `expenses` ga
--  tushmasligi. Buni ilovadagi yangi "Tovar olish" ekrani hal qiladi.
-- ============================================================

CREATE INDEX IF NOT EXISTS purchases_shop_day_idx
  ON purchases (shop_id, dokon_kun(created_at));

DROP VIEW IF EXISTS daily_summary;
CREATE VIEW daily_summary AS
WITH faktlar AS (
  -- --- Savdo ---
  SELECT shop_id,
         dokon_kun(created_at)  AS day,
         total                  AS sales_total,
         cost_total             AS cost_total,
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
         0::numeric             AS debt_given,
         0::numeric             AS purchase_total
    FROM sales

  UNION ALL

  -- --- Chiqim ---
  SELECT shop_id, dokon_kun(created_at),
         0, 0, 0, 0, 0, 0, 0,
         amount,
         0, 0, 0
    FROM expenses
   WHERE deleted_at IS NULL

  UNION ALL

  -- --- Omborga kirim (tovar xaridi) ---
  -- Foydaga TEGMAYDI (yuqoridagi izohga qarang), faqat ko'rsatiladi.
  SELECT shop_id, dokon_kun(created_at),
         0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
         total
    FROM purchases

  UNION ALL

  -- --- Qarz daftari ---
  -- Faqat yakunga ta'sir qiladigan qatorlar: to'lovlar (amount < 0) va
  -- QO'LDA berilgan qarz (`sale_id IS NULL`). Savdodan chiqqan qarz
  -- `credit_total` da allaqachon bor — ikki marta sanalmasin.
  SELECT shop_id, dokon_kun(created_at),
         0, 0, 0, 0, 0, 0, 0, 0,
         -- to'langan qarz = kirim
         CASE WHEN amount < 0 THEN -amount ELSE 0 END,
         -- qo'lda berilgan qarz
         CASE WHEN amount > 0 AND sale_id IS NULL THEN amount ELSE 0 END,
         0
    FROM debts
   WHERE amount < 0 OR sale_id IS NULL
)
SELECT shop_id,
       day,
       SUM(sales_total)                   AS sales_total,
       -- SOTILGAN MOLNING TAN NARXI.
       --
       -- Busiz hisobotdagi raqamlar bir-biriga bog'lanmasdi: do'konchi
       -- "Savdo 18 000, Chiqim 105 000, Foyda −101 580" ni ko'rib,
       -- 18 000 − 105 000 = −87 000 deb hisoblardi va farq qayerdan
       -- kelganini tushunmasdi. Yetishmayotgan bo'g'in shu — mol o'zi
       -- necha pulga olingani.
       --
       --   Savdo − Tan narx = Yalpi foyda
       --   Yalpi foyda − Chiqim = Sof foyda
       SUM(cost_total)                    AS cost_total,
       -- KUNLIK TUSHUM = savdodan olingan naqd + qarz to'lovlari.
       -- Savdo summasidan FARQ QILADI: qarzga sotilgani bugun pul
       -- keltirmaydi, eski qarzning to'lovi esa bugungi savdoga
       -- bog'liq bo'lmasa ham bugun kassaga tushadi.
       SUM(cash_in) + SUM(debt_paid)      AS cash_in,
       -- Ikkalasi alohida — aks holda tushum qayerdan yig'ilgani
       -- ko'rinmasdi va do'konchi raqamni tekshira olmasdi.
       SUM(cash_in)                       AS sales_cash,
       SUM(debt_paid)                     AS debt_paid,
       SUM(expense_total)                 AS expense_total,
       SUM(gross_profit) - SUM(expense_total) AS net_profit,
       SUM(sales_count)                   AS sales_count,
       SUM(credit_total)                  AS credit_total,
       ROUND(SUM(credit_profit), 2)       AS credit_profit,
       -- Qo'lda berilgan qarz. Tushum va foydaga ta'sir qilmaydi (mol
       -- chiqmagan, tannarx yo'q) — lekin do'konchi kuni bilan qancha
       -- qarz tarqatganini ko'rishi kerak.
       SUM(debt_given)                    AS debt_given,
       -- Tovarga sarflangan pul. Foydadan AYIRILMAYDI — u tan narx
       -- bo'lib sotilgan kuni ayiriladi. Bu yerda faqat "kassadan
       -- shuncha chiqdi" degan ma'lumot.
       SUM(purchase_total)                AS purchase_total
  FROM faktlar
 GROUP BY shop_id, day;
