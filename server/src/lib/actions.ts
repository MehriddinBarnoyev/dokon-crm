/**
 * AMALLAR (ACTIONS)
 * ==================
 * Bazani o'zgartiradigan har bir operatsiya shu yerda ta'riflanadi.
 *
 * Nega alohida qatlam? AI ham, qo'lda kiritish ham aynan shu amallarni
 * ishlab chiqaradi. AI faqat "amal ro'yxatini taklif qiladi" — bajarish
 * har doim shu yerdagi tranzaksiya orqali o'tadi. Shunday qilib AI
 * hech qachon bazaga to'g'ridan-to'g'ri yozmaydi.
 */
import { z } from 'zod';
import type pg from 'pg';
import { one, query } from '../db.js';

export const UNITS = ['dona', 'kg', 'gram', 'litr', 'metr', 'quti', 'pachka'] as const;
export const UnitSchema = z.enum(UNITS);
export type Unit = z.infer<typeof UnitSchema>;

export const PaymentSchema = z.enum(['naqd', 'karta', 'qarz', 'aralash']);

const uuid = z.string().uuid();
const money = z.number().finite().nonnegative();
const qty = z.number().finite().positive();

/* ----------------------------- Amal sxemalari ---------------------------- */

const SaleItem = z.object({
  product_id: uuid.nullable().default(null),
  name: z.string().min(1),
  unit: UnitSchema.default('dona'),
  qty,
  unit_price: money,
});

export const ActionSchema = z.discriminatedUnion('type', [
  /** Savdo: ombordan chiqim + kunlik kirim */
  z.object({
    type: z.literal('sale'),
    items: z.array(SaleItem).min(1),
    customer_id: uuid.nullable().default(null),
    customer_name: z.string().nullable().default(null),
    payment_method: PaymentSchema.default('naqd'),
    /** Naqd/karta bilan to'langan qism. Qolgani avtomatik qarzga yoziladi. */
    paid: money.nullable().default(null),
    note: z.string().nullable().default(null),
  }),

  /** Omborga kirim (yetkazib beruvchidan mahsulot olindi) */
  z.object({
    type: z.literal('purchase'),
    supplier: z.string().nullable().default(null),
    items: z.array(z.object({
      product_id: uuid.nullable().default(null),
      name: z.string().min(1),
      unit: UnitSchema.default('dona'),
      qty,
      cost_price: money,
      /** Yangi mahsulot bo'lsa — sotuv narxi ham belgilanadi */
      sale_price: money.nullable().default(null),
    })).min(1),
    note: z.string().nullable().default(null),
  }),

  /** Qarz berildi (mijoz bizga qarzdor bo'ldi) */
  z.object({
    type: z.literal('debt'),
    customer_id: uuid.nullable().default(null),
    customer_name: z.string().min(1),
    customer_phone: z.string().nullable().default(null),
    amount: money.refine((v) => v > 0, 'summa noldan katta bo\'lishi kerak'),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    note: z.string().nullable().default(null),
  }),

  /** Qarz to'landi */
  z.object({
    type: z.literal('debt_payment'),
    customer_id: uuid.nullable().default(null),
    customer_name: z.string().min(1),
    amount: money.refine((v) => v > 0, 'summa noldan katta bo\'lishi kerak'),
    note: z.string().nullable().default(null),
  }),

  /** Chiqim (ijara, transport, oylik...) */
  z.object({
    type: z.literal('expense'),
    category: z.string().default('boshqa'),
    amount: money.refine((v) => v > 0, 'summa noldan katta bo\'lishi kerak'),
    note: z.string().nullable().default(null),
  }),

  /** Yangi mahsulot qo'shish */
  z.object({
    type: z.literal('create_product'),
    name: z.string().min(1),
    unit: UnitSchema.default('dona'),
    cost_price: money.default(0),
    sale_price: money.default(0),
    stock: z.number().finite().nonnegative().default(0),
    category: z.string().nullable().default(null),
    barcode: z.string().nullable().default(null),
    photo_url: z.string().nullable().default(null),
  }),

  /** Qoldiqni qo'lda tuzatish (inventarizatsiya) */
  z.object({
    type: z.literal('stock_adjust'),
    product_id: uuid,
    new_stock: z.number().finite().nonnegative(),
    note: z.string().nullable().default(null),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type SaleAction = Extract<Action, { type: 'sale' }>;

export interface ExecCtx {
  shopId: string;
  userId: string | null;
  source: 'manual' | 'ai';
}

export interface ActionResult {
  type: Action['type'];
  summary: string;
  id?: string;
  warnings: string[];
}

/* ------------------------------ Yordamchilar ----------------------------- */

const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format(Math.round(n));

/** Mijozni topadi, bo'lmasa yaratadi. */
async function resolveCustomer(
  c: pg.PoolClient,
  shopId: string,
  id: string | null,
  name: string | null,
  phone: string | null = null,
): Promise<{ id: string; name: string } | null> {
  if (id) {
    const row = await one<{ id: string; name: string }>(
      `SELECT id, name FROM customers WHERE id = $1 AND shop_id = $2`, [id, shopId], c);
    if (row) return row;
  }
  if (!name) return null;

  // Aynan mos keladigan nom (registr farqisiz)
  const exact = await one<{ id: string; name: string }>(
    `SELECT id, name FROM customers
      WHERE shop_id = $1 AND lower(name) = lower($2) LIMIT 1`, [shopId, name], c);
  if (exact) return exact;

  const created = await one<{ id: string; name: string }>(
    `INSERT INTO customers (shop_id, name, phone) VALUES ($1, $2, $3) RETURNING id, name`,
    [shopId, name, phone], c);
  return created!;
}

/** Mahsulot qatorini qulflab oladi (parallel savdolarda qoldiq buzilmasligi uchun). */
async function lockProduct(c: pg.PoolClient, shopId: string, productId: string) {
  return one<{ id: string; name: string; unit: Unit; stock: number; cost_price: number; sale_price: number }>(
    `SELECT id, name, unit, stock, cost_price, sale_price
       FROM products WHERE id = $1 AND shop_id = $2 FOR UPDATE`,
    [productId, shopId], c);
}

/** Qoldiqni o'zgartirib, harakatni jurnalga yozadi. */
async function moveStock(
  c: pg.PoolClient, ctx: ExecCtx,
  productId: string, delta: number,
  refType: string, refId: string | null, note: string | null,
): Promise<number> {
  const upd = await one<{ stock: number }>(
    `UPDATE products SET stock = stock + $1, updated_at = now()
      WHERE id = $2 AND shop_id = $3 RETURNING stock`,
    [delta, productId, ctx.shopId], c);
  const after = upd!.stock;

  await query(
    `INSERT INTO stock_moves (shop_id, product_id, type, qty, stock_after, ref_type, ref_id, note, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.shopId, productId, delta >= 0 ? 'kirim' : 'chiqim', Math.abs(delta),
     after, refType, refId, note, ctx.userId], c);
  return after;
}

/* ------------------------------- Bajaruvchi ------------------------------ */

/**
 * Amallar ro'yxatini BITTA tranzaksiyada bajaradi.
 * `c` — chaqiruvchi tomonidan ochilgan tranzaksiya klienti.
 */
export async function executeActions(
  c: pg.PoolClient,
  ctx: ExecCtx,
  actions: Action[],
): Promise<ActionResult[]> {
  const out: ActionResult[] = [];

  for (const a of actions) {
    switch (a.type) {
      /* ------------------------------ SAVDO ------------------------------ */
      case 'sale': {
        const warnings: string[] = [];
        const customer = await resolveCustomer(c, ctx.shopId, a.customer_id, a.customer_name);

        let total = 0;
        let costTotal = 0;
        const prepared: Array<{
          product_id: string | null; name: string; unit: Unit;
          qty: number; unit_price: number; cost_price: number; subtotal: number;
        }> = [];

        for (const item of a.items) {
          let cost = 0;
          let unit: Unit = item.unit;
          let name = item.name;

          if (item.product_id) {
            const p = await lockProduct(c, ctx.shopId, item.product_id);
            if (!p) throw new Error(`Mahsulot topilmadi: ${item.name}`);
            cost = p.cost_price;
            unit = p.unit;
            name = p.name;
            if (p.stock < item.qty) {
              warnings.push(
                `"${p.name}" omborda ${p.stock} ${p.unit} qolgan, lekin ${item.qty} ${p.unit} sotilyapti — qoldiq minusga tushadi.`);
            }
          } else {
            warnings.push(`"${item.name}" bazada yo'q — savdo yozildi, lekin ombor qoldig'i o'zgarmadi.`);
          }

          const subtotal = item.qty * item.unit_price;
          total += subtotal;
          costTotal += item.qty * cost;
          prepared.push({ ...item, name, unit, cost_price: cost, subtotal });
        }

        // To'lov taqsimoti: `paid` berilmasa, qarzda 0, aks holda to'liq to'langan.
        const paid = a.paid ?? (a.payment_method === 'qarz' ? 0 : total);
        const owed = Math.max(0, total - paid);

        if (owed > 0 && !customer) {
          throw new Error("Qarzga sotish uchun mijoz nomi kerak.");
        }

        const sale = await one<{ id: string }>(
          `INSERT INTO sales (shop_id, user_id, customer_id, total, cost_total, paid, payment_method, note, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [ctx.shopId, ctx.userId, customer?.id ?? null, total, costTotal, paid,
           a.payment_method, a.note, ctx.source], c);

        for (const p of prepared) {
          await query(
            `INSERT INTO sale_items (sale_id, product_id, name_snap, unit, qty, unit_price, cost_price, subtotal)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [sale!.id, p.product_id, p.name, p.unit, p.qty, p.unit_price, p.cost_price, p.subtotal], c);

          if (p.product_id) {
            await moveStock(c, ctx, p.product_id, -p.qty, 'sale', sale!.id, 'Savdo');
          }
        }

        if (owed > 0) {
          await query(
            `INSERT INTO debts (shop_id, customer_id, sale_id, amount, note, user_id, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [ctx.shopId, customer!.id, sale!.id, owed, 'Savdodan qarz', ctx.userId, ctx.source], c);
        }

        const what = prepared.map((p) => `${p.qty} ${p.unit} ${p.name}`).join(', ');
        out.push({
          type: 'sale', id: sale!.id, warnings,
          summary: `Savdo: ${what} — ${fmt(total)} so'm`
            + (owed > 0 ? ` (${fmt(owed)} so'm qarz: ${customer!.name})` : ''),
        });
        break;
      }

      /* ---------------------------- OMBORGA KIRIM ------------------------- */
      case 'purchase': {
        const warnings: string[] = [];
        let total = 0;

        const purchase = await one<{ id: string }>(
          `INSERT INTO purchases (shop_id, user_id, supplier, total, note, source)
           VALUES ($1,$2,$3,0,$4,$5) RETURNING id`,
          [ctx.shopId, ctx.userId, a.supplier, a.note, ctx.source], c);

        for (const item of a.items) {
          let productId = item.product_id;
          let unit: Unit = item.unit;
          let name = item.name;

          if (productId) {
            const p = await lockProduct(c, ctx.shopId, productId);
            if (!p) throw new Error(`Mahsulot topilmadi: ${item.name}`);
            unit = p.unit; name = p.name;
          } else {
            // Bazada yo'q mahsulot — kirim paytida avtomatik ochiladi.
            const created = await one<{ id: string }>(
              `INSERT INTO products (shop_id, name, unit, cost_price, sale_price, stock)
               VALUES ($1,$2,$3,$4,$5,0) RETURNING id`,
              [ctx.shopId, item.name, item.unit, item.cost_price,
               item.sale_price ?? item.cost_price, ], c);
            productId = created!.id;
            warnings.push(`"${item.name}" yangi mahsulot sifatida ochildi.`);
          }

          const subtotal = item.qty * item.cost_price;
          total += subtotal;

          await query(
            `INSERT INTO purchase_items (purchase_id, product_id, name_snap, unit, qty, cost_price, subtotal)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [purchase!.id, productId, name, unit, item.qty, item.cost_price, subtotal], c);

          await moveStock(c, ctx, productId, item.qty, 'purchase', purchase!.id, 'Omborga kirim');

          // Tan narxni oxirgi kirim bo'yicha yangilaymiz
          await query(
            `UPDATE products SET cost_price = $1, updated_at = now() WHERE id = $2`,
            [item.cost_price, productId], c);
          if (item.sale_price) {
            await query(`UPDATE products SET sale_price = $1 WHERE id = $2`,
              [item.sale_price, productId], c);
          }
        }

        await query(`UPDATE purchases SET total = $1 WHERE id = $2`, [total, purchase!.id], c);

        const what = a.items.map((i) => `${i.qty} ${i.unit} ${i.name}`).join(', ');
        out.push({
          type: 'purchase', id: purchase!.id, warnings,
          summary: `Omborga kirim: ${what} — ${fmt(total)} so'm`,
        });
        break;
      }

      /* ------------------------------- QARZ ------------------------------- */
      case 'debt': {
        const customer = await resolveCustomer(
          c, ctx.shopId, a.customer_id, a.customer_name, a.customer_phone);
        if (!customer) throw new Error('Mijozni aniqlab bo\'lmadi.');

        const row = await one<{ id: string }>(
          `INSERT INTO debts (shop_id, customer_id, amount, due_date, note, user_id, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [ctx.shopId, customer.id, a.amount, a.due_date, a.note, ctx.userId, ctx.source], c);

        out.push({
          type: 'debt', id: row!.id, warnings: [],
          summary: `Qarz: ${customer.name} — ${fmt(a.amount)} so'm`
            + (a.due_date ? ` (muddat: ${a.due_date})` : ''),
        });
        break;
      }

      case 'debt_payment': {
        const customer = await resolveCustomer(c, ctx.shopId, a.customer_id, a.customer_name);
        if (!customer) throw new Error(`Mijoz topilmadi: ${a.customer_name}`);

        const bal = await one<{ balance: number }>(
          `SELECT COALESCE(SUM(amount),0) AS balance FROM debts WHERE customer_id = $1`,
          [customer.id], c);
        const warnings: string[] = [];
        if (a.amount > (bal?.balance ?? 0)) {
          warnings.push(
            `${customer.name} ning qarzi ${fmt(bal?.balance ?? 0)} so'm, `
            + `lekin ${fmt(a.amount)} so'm to'lov yozilyapti — balans oldindan to'lovga o'tadi.`);
        }

        const row = await one<{ id: string }>(
          `INSERT INTO debts (shop_id, customer_id, amount, note, user_id, source)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ctx.shopId, customer.id, -a.amount, a.note ?? 'Qarz to\'lovi', ctx.userId, ctx.source], c);

        out.push({
          type: 'debt_payment', id: row!.id, warnings,
          summary: `Qarz to'lovi: ${customer.name} — ${fmt(a.amount)} so'm`,
        });
        break;
      }

      /* ------------------------------ CHIQIM ------------------------------ */
      case 'expense': {
        const row = await one<{ id: string }>(
          `INSERT INTO expenses (shop_id, user_id, category, amount, note, source)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ctx.shopId, ctx.userId, a.category, a.amount, a.note, ctx.source], c);
        out.push({
          type: 'expense', id: row!.id, warnings: [],
          summary: `Chiqim (${a.category}): ${fmt(a.amount)} so'm`,
        });
        break;
      }

      /* --------------------------- YANGI MAHSULOT -------------------------- */
      case 'create_product': {
        let categoryId: string | null = null;
        if (a.category) {
          const cat = await one<{ id: string }>(
            `INSERT INTO categories (shop_id, name) VALUES ($1, $2)
             ON CONFLICT (shop_id, name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`, [ctx.shopId, a.category], c);
          categoryId = cat!.id;
        }

        const row = await one<{ id: string }>(
          `INSERT INTO products (shop_id, name, unit, cost_price, sale_price, stock, category_id, barcode, photo_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [ctx.shopId, a.name, a.unit, a.cost_price, a.sale_price, a.stock,
           categoryId, a.barcode, a.photo_url], c);

        if (a.stock > 0) {
          await query(
            `INSERT INTO stock_moves (shop_id, product_id, type, qty, stock_after, ref_type, note, user_id)
             VALUES ($1,$2,'kirim',$3,$3,'manual','Boshlang''ich qoldiq',$4)`,
            [ctx.shopId, row!.id, a.stock, ctx.userId], c);
        }

        out.push({
          type: 'create_product', id: row!.id, warnings: [],
          summary: `Yangi mahsulot: ${a.name} (${a.sale_price ? fmt(a.sale_price) + " so'm/" + a.unit : a.unit})`,
        });
        break;
      }

      /* --------------------------- QOLDIQ TUZATISH ------------------------- */
      case 'stock_adjust': {
        const p = await lockProduct(c, ctx.shopId, a.product_id);
        if (!p) throw new Error('Mahsulot topilmadi.');
        const delta = a.new_stock - p.stock;

        await query(`UPDATE products SET stock = $1, updated_at = now() WHERE id = $2`,
          [a.new_stock, a.product_id], c);
        await query(
          `INSERT INTO stock_moves (shop_id, product_id, type, qty, stock_after, ref_type, note, user_id)
           VALUES ($1,$2,'tuzatish',$3,$4,'manual',$5,$6)`,
          [ctx.shopId, a.product_id, Math.abs(delta), a.new_stock,
           a.note ?? 'Inventarizatsiya', ctx.userId], c);

        out.push({
          type: 'stock_adjust', id: a.product_id, warnings: [],
          summary: `Qoldiq tuzatildi: ${p.name} ${p.stock} → ${a.new_stock} ${p.unit}`,
        });
        break;
      }
    }
  }

  return out;
}
