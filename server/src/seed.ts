/**
 * Sinov ma'lumotlari.
 * Ishga tushirish:  npm run db:seed
 * Kirish:           +998901234567 / 1234
 */
import bcrypt from 'bcryptjs';
import { one, pool, query, tx } from './db.js';
import { executeActions } from './lib/actions.js';

const PHONE = '+998901234567';
const PASSWORD = '1234';

const PRODUCTS = [
  { name: 'Piyoz',            unit: 'kg',     cost: 3000,  sale: 5000,  stock: 50,  min: 10 , cat: 'sabzavot' },
  { name: 'Kartoshka',        unit: 'kg',     cost: 4000,  sale: 6500,  stock: 80,  min: 15 , cat: 'sabzavot' },
  { name: 'Sabzi',            unit: 'kg',     cost: 3500,  sale: 5500,  stock: 40,  min: 10 , cat: 'sabzavot' },
  { name: 'Guruch Lazer 1kg', unit: 'dona',   cost: 18000, sale: 23000, stock: 25,  min: 5  , cat: 'yorma' },
  { name: 'Shakar',           unit: 'kg',     cost: 11000, sale: 13500, stock: 60,  min: 10 , cat: 'yorma' },
  { name: "O'simlik yog'i 1L", unit: 'dona',  cost: 21000, sale: 26000, stock: 30,  min: 6  , cat: 'oziq-ovqat' },
  { name: 'Coca-Cola 1.5L',   unit: 'dona',   cost: 12000, sale: 16000, stock: 48,  min: 12 , cat: 'ichimlik' },
  { name: 'Non',              unit: 'dona',   cost: 2500,  sale: 4000,  stock: 20,  min: 10 , cat: 'non-bulka' },
  { name: 'Sut 1L',           unit: 'dona',   cost: 9000,  sale: 12000, stock: 18,  min: 8  , cat: 'sut mahsulotlari' },
  { name: 'Tuxum',            unit: 'dona',   cost: 1200,  sale: 1800,  stock: 120, min: 30 , cat: 'oziq-ovqat' },
  { name: 'Makaron 500g',     unit: 'dona',   cost: 6000,  sale: 8500,  stock: 35,  min: 10 , cat: 'yorma' },
  { name: 'Choy Ahmad 100g',  unit: 'dona',   cost: 14000, sale: 19000, stock: 4,   min: 8  , cat: 'ichimlik' },
  { name: 'Kir yuvish kukuni', unit: 'dona',  cost: 25000, sale: 32000, stock: 12,  min: 4  , cat: 'maishiy kimyo' },
  { name: 'Mato (chit)',      unit: 'metr',   cost: 15000, sale: 22000, stock: 65,  min: 20 , cat: 'gazlama' },
  { name: 'Suv 5L',           unit: 'litr',   cost: 4000,  sale: 6000,  stock: 90,  min: 20 , cat: 'ichimlik' },
] as const;

const CUSTOMERS = [
  { name: 'Alisher Karimov',  phone: '+998901112233' },
  { name: 'Dilnoza Rahimova', phone: '+998907778899' },
  { name: "Bobur To'raev",    phone: '+998933334455' },
  { name: 'Nodira Yusupova',  phone: null },
] as const;

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

async function main() {
  console.log('Sinov ma\'lumotlari yaratilmoqda...');

  // Avvalgi sinov do'konini tozalaymiz (CASCADE hammasini olib ketadi)
  const old = await one<{ shop_id: string }>(
    `SELECT shop_id FROM users WHERE phone = $1`, [PHONE]);
  if (old) {
    await query(`DELETE FROM shops WHERE id = $1`, [old.shop_id]);
    console.log('  eski sinov ma\'lumotlari o\'chirildi');
  }

  const hash = await bcrypt.hash(PASSWORD, 10);

  const { shopId, userId } = await tx(async (c) => {
    const shop = await one<{ id: string }>(
      `INSERT INTO shops (name) VALUES ($1) RETURNING id`, ["Baraka Do'koni"], c);
    const user = await one<{ id: string }>(
      `INSERT INTO users (shop_id, phone, name, password_hash, role)
       VALUES ($1,$2,$3,$4,'owner') RETURNING id`,
      [shop!.id, PHONE, 'Mehriddin', hash], c);
    return { shopId: shop!.id, userId: user!.id };
  });

  const ctx = { shopId, userId, source: 'manual' as const };

  // --- Mahsulotlar ---
  await tx(async (c) => {
    for (const p of PRODUCTS) {
      await executeActions(c, ctx, [{
        type: 'create_product',
        name: p.name, unit: p.unit as any,
        cost_price: p.cost, sale_price: p.sale, stock: p.stock,
        category: (p as { cat?: string }).cat ?? null, barcode: null, photo_url: null,
      }]);
    }
  });
  await query(
    `UPDATE products p SET min_stock = v.min
       FROM (VALUES ${PRODUCTS.map((p, i) => `($${i * 2 + 2}, $${i * 2 + 3}::numeric)`).join(',')})
            AS v(name, min)
      WHERE p.shop_id = $1 AND p.name = v.name`,
    [shopId, ...PRODUCTS.flatMap((p) => [p.name, p.min])]);
  console.log(`  ${PRODUCTS.length} ta mahsulot qo'shildi`);

  // --- Mijozlar ---
  await query(
    `INSERT INTO customers (shop_id, name, phone)
     SELECT $1, x.name, x.phone FROM unnest($2::text[], $3::text[]) AS x(name, phone)`,
    [shopId, CUSTOMERS.map((c) => c.name), CUSTOMERS.map((c) => c.phone)]);
  console.log(`  ${CUSTOMERS.length} ta mijoz qo'shildi`);

  const products = await query<{ id: string; name: string; unit: string; sale_price: number }>(
    `SELECT id, name, unit, sale_price FROM products WHERE shop_id = $1`, [shopId]);
  const customers = await query<{ id: string; name: string }>(
    `SELECT id, name FROM customers WHERE shop_id = $1`, [shopId]);

  // --- Oxirgi 14 kunlik savdo tarixi ---
  let saleCount = 0;
  for (let d = 13; d >= 0; d--) {
    const perDay = Math.floor(rnd(4, 11));
    for (let i = 0; i < perDay; i++) {
      const n = Math.floor(rnd(1, 4));
      const chosen = [...products].sort(() => Math.random() - 0.5).slice(0, n);
      const qarzga = Math.random() < 0.15;
      const customer = qarzga ? pick(customers) : null;

      await tx(async (c) => {
        const [res] = await executeActions(c, ctx, [{
          type: 'sale',
          items: chosen.map((p) => ({
            product_id: p.id, name: p.name, unit: p.unit as any,
            qty: p.unit === 'kg' || p.unit === 'metr' || p.unit === 'litr'
              ? Math.round(rnd(0.5, 4) * 2) / 2
              : Math.floor(rnd(1, 5)),
            unit_price: p.sale_price,
            subtotal: null,
          })),
          customer_id: customer?.id ?? null,
          customer_name: customer?.name ?? null,
          payment_method: qarzga ? 'qarz' : (Math.random() < 0.3 ? 'karta' : 'naqd'),
          paid: qarzga ? 0 : null,
          note: null,
        }]);
        // Savdoni o'tgan kunga surib qo'yamiz
        await query(
          `UPDATE sales SET created_at = now() - ($1::int || ' days')::interval
                                       - ($2::int || ' hours')::interval
            WHERE id = $3`, [d, Math.floor(rnd(0, 12)), res.id], c);
      });
      saleCount++;
    }

    // Har 4 kunda yetkazib beruvchidan kirim — qoldiq minusga tushmasligi uchun
    if (d % 4 === 0) {
      const low = await query<{ id: string; name: string; unit: string; cost_price: number }>(
        `SELECT id, name, unit, cost_price FROM products
          WHERE shop_id = $1 AND stock < min_stock * 3 ORDER BY stock LIMIT 6`, [shopId]);
      if (low.length) {
        await tx(async (c) => {
          const [res] = await executeActions(c, ctx, [{
            type: 'purchase',
            supplier: pick(['Omad Savdo', 'Baraka Optom', 'Toshkent Optom']),
            items: low.map((p) => ({
              product_id: p.id, name: p.name, unit: p.unit as any,
              qty: Math.round(rnd(20, 60)), cost_price: p.cost_price, sale_price: null,
            })),
            note: null,
          }]);
          await query(
            `UPDATE purchases SET created_at = now() - ($1::int || ' days')::interval WHERE id = $2`,
            [d, res.id], c);
        });
      }
    }

    // Kunlik chiqim
    if (Math.random() < 0.5) {
      await tx(async (c) => {
        const [res] = await executeActions(c, ctx, [{
          type: 'expense',
          category: pick(['transport', 'ijara', 'kommunal', 'oylik', 'boshqa']),
          amount: Math.round(rnd(20, 200)) * 1000,
          note: null,
        }]);
        await query(
          `UPDATE expenses SET created_at = now() - ($1::int || ' days')::interval WHERE id = $2`,
          [d, res.id], c);
      });
    }
  }
  console.log(`  ${saleCount} ta savdo yozildi (14 kunlik tarix)`);

  // --- Bir nechta ochiq qarz ---
  await tx(async (c) => {
    await executeActions(c, ctx, [
      { type: 'debt', customer_id: customers[0]!.id, customer_name: customers[0]!.name,
        customer_phone: null, amount: 250000,
        due_date: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10),  // muddati o'tgan
        created_at: null, note: 'Naqd qarz' },
      { type: 'debt', customer_id: customers[1]!.id, customer_name: customers[1]!.name,
        customer_phone: null, amount: 120000,
        due_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
        created_at: null, note: null },
    ]);
  });
  console.log('  qarzlar qo\'shildi');

  const summary = await one(
    `SELECT (SELECT COUNT(*) FROM products WHERE shop_id = $1) AS mahsulot,
            (SELECT COUNT(*) FROM sales WHERE shop_id = $1) AS savdo,
            (SELECT COALESCE(SUM(balance),0) FROM customer_balances WHERE shop_id = $1) AS qarz`,
    [shopId]);

  console.log('\nTayyor!');
  console.log(`  Do'kon:  Baraka Do'koni`);
  console.log(`  Telefon: ${PHONE}`);
  console.log(`  Parol:   ${PASSWORD}`);
  console.log(`  Holat:   ${JSON.stringify(summary)}`);

  await pool.end();
}

main().catch(async (e) => {
  console.error('Xato:', e);
  await pool.end();
  process.exit(1);
});
