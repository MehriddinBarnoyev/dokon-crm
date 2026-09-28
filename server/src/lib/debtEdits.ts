/**
 * QARZ/TO'LOV YOZUVINI TAHRIRLASH VA O'CHIRISH.
 *
 * Ikki joydan chaqiriladi: `routes/debts.ts` (onlayn, oddiy REST) va
 * `routes/flush.ts` (offline navbat orqali, `debt_update`/`debt_delete`) —
 * mantiq ikkalasida bir xil bo'lishi shart, shuning uchun bir marta shu
 * yerda yozilgan.
 */
import { one, query, type Sql } from '../db.js';

export interface DebtRow {
  id: string; amount: number; due_date: string | null; note: string | null;
  sale_id: string | null; created_at: string; updated_at: string;
}

export async function patchDebtEntry(
  shopId: string,
  id: string,
  patch: { amount?: number; due_date?: string | null; note?: string | null },
  c?: Sql,
): Promise<DebtRow> {
  const row = await one<{ id: string; amount: number; sale_id: string | null }>(
    `SELECT id, amount, sale_id FROM debts
      WHERE id = $1 AND shop_id = $2 AND deleted_at IS NULL`,
    [id, shopId], c);
  if (!row) throw new Error('Yozuv topilmadi');
  if (row.sale_id) {
    throw new Error(
      "Savdodan yozilgan qarzni bu yerdan tahrirlab bo'lmaydi — uni o'zgartirish uchun savdoni bekor qiling.");
  }

  // Yozuv qarzmi yoki to'lovmi — ISHORA saqlanadi, `amount` mijozdan
  // har doim musbat (kattalik) sifatida keladi.
  const tolovmi = Number(row.amount) < 0;
  if (patch.due_date !== undefined && patch.due_date !== null && tolovmi) {
    throw new Error("To'lov yozuviga muddat qo'yib bo'lmaydi");
  }

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];
  if (patch.amount !== undefined) {
    params.push(tolovmi ? -patch.amount : patch.amount);
    sets.push(`amount = $${params.length}`);
  }
  if (patch.due_date !== undefined) {
    params.push(patch.due_date);
    sets.push(`due_date = $${params.length}`);
  }
  if (patch.note !== undefined) {
    params.push(patch.note);
    sets.push(`note = $${params.length}`);
  }

  params.push(id, shopId);
  const updated = await one<DebtRow>(
    `UPDATE debts SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND shop_id = $${params.length}
      RETURNING id, amount, due_date, note, sale_id, created_at, updated_at`,
    params, c);
  return updated!;
}

/** Yumshoq o'chirish — `expenses`dagi kabi, pul yozuvi izsiz yo'qolmasin. */
export async function deleteDebtEntry(shopId: string, id: string, c?: Sql): Promise<{ id: string }> {
  const row = await one<{ id: string; sale_id: string | null }>(
    `SELECT id, sale_id FROM debts
      WHERE id = $1 AND shop_id = $2 AND deleted_at IS NULL`,
    [id, shopId], c);
  if (!row) throw new Error('Yozuv topilmadi');
  if (row.sale_id) {
    throw new Error(
      "Savdodan yozilgan qarzni bu yerdan o'chirib bo'lmaydi — uni o'chirish uchun savdoni bekor qiling.");
  }

  await query(`UPDATE debts SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id], c);
  return { id };
}
