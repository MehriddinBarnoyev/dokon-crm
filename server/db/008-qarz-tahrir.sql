-- ============================================================
--  QARZ YOZUVLARINI TAHRIRLASH VA O'CHIRISH
--
--  Ba'zida qarz yoki to'lov XATO yoziladi — boshqa mijozga, xato summada.
--  Hozirgacha buni tuzatishning yagona yo'li yangi TESKARI yozuv qo'shish
--  edi, bu esa tarixni chalkashtiradi ("nega bitta xatoni tuzatish uchun
--  ikkita qo'shimcha qator bor?").
--
--  Faqat QO'LDA kiritilgan yozuvlar tahrirlanadi (`sale_id IS NULL`) —
--  savdodan avtomatik yozilgan qarz savdo bilan bog'liq, uni alohida
--  o'zgartirish savdo va qarz orasidagi muvofiqlikni buzadi (batafsil —
--  `server/src/routes/debts.ts`).
--
--  O'CHIRISH YUMSHOQ — `expenses` dagi kabi: pulga tegishli qator qattiq
--  DELETE qilinsa, xato bosilganda hech qanday iz qolmaydi.
-- ============================================================

ALTER TABLE debts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE debts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- O'chirilgan yozuv balansga va "oxirgi faollik"ka kirmasin.
CREATE OR REPLACE VIEW customer_balances AS
SELECT c.id           AS customer_id,
       c.shop_id,
       c.name,
       c.phone,
       COALESCE(SUM(d.amount), 0)                  AS balance,
       MIN(d.due_date) FILTER (WHERE d.amount > 0) AS nearest_due,
       MAX(d.created_at)                           AS last_activity
FROM customers c
LEFT JOIN debts d ON d.customer_id = c.id AND d.deleted_at IS NULL
GROUP BY c.id, c.shop_id, c.name, c.phone;

-- `daily_summary` — 006-tovar.sql dagi ta'rifning aynan o'zi, faqat
-- "Qarz daftari" bo'limida o'chirilgan yozuvlar endi hisobga kirmaydi.
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
         GREATEST(total - paid, 0) AS credit_total,
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
  SELECT shop_id, dokon_kun(created_at),
         0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
         total
    FROM purchases

  UNION ALL

  -- --- Qarz daftari ---
  -- O'chirilgan (tahrirdan keyin bekor qilingan) yozuvlar endi qo'shilmaydi.
  SELECT shop_id, dokon_kun(created_at),
         0, 0, 0, 0, 0, 0, 0, 0,
         CASE WHEN amount < 0 THEN -amount ELSE 0 END,
         CASE WHEN amount > 0 AND sale_id IS NULL THEN amount ELSE 0 END,
         0
    FROM debts
   WHERE (amount < 0 OR sale_id IS NULL) AND deleted_at IS NULL
)
SELECT shop_id,
       day,
       SUM(sales_total)                   AS sales_total,
       SUM(cost_total)                    AS cost_total,
       SUM(cash_in) + SUM(debt_paid)      AS cash_in,
       SUM(cash_in)                       AS sales_cash,
       SUM(debt_paid)                     AS debt_paid,
       SUM(expense_total)                 AS expense_total,
       SUM(gross_profit) - SUM(expense_total) AS net_profit,
       SUM(sales_count)                   AS sales_count,
       SUM(credit_total)                  AS credit_total,
       ROUND(SUM(credit_profit), 2)       AS credit_profit,
       SUM(debt_given)                    AS debt_given,
       SUM(purchase_total)                AS purchase_total
  FROM faktlar
 GROUP BY shop_id, day;
