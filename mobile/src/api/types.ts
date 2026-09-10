export type Unit = 'dona' | 'kg' | 'gram' | 'litr' | 'metr' | 'quti' | 'pachka';
export type PaymentMethod = 'naqd' | 'karta' | 'qarz' | 'aralash';

export interface User { id: string; shop_id: string; role: 'owner' | 'seller'; name: string }
export interface Shop { id: string; name: string; currency: string }

export interface Product {
  id: string; name: string; barcode: string | null; unit: Unit;
  /**
   * Mahsulotning BARCHA shtrix-kodlari: asosiy (`barcode`) + qo'shimchalari.
   *
   * Ayni mahsulot har xil partiyada har xil kod bilan keladi ("Fanta 1L"
   * eski va yangi qadoqda). Skaner shu ro'yxat bo'yicha qidiradi.
   * Server `/sync/products` da beradi, shuning uchun oflaynda ham bor.
   */
  barcodes?: string[];
  cost_price: number; sale_price: number; stock: number; min_stock: number;
  photo_url: string | null; category: string | null;
  /** Qidiruvda: true bo'lsa aniq moslik emas, taxminiy variant. */
  taxminiy?: boolean;
  score?: number;
}

export interface SaleItem {
  name: string; qty: number; unit: Unit; unit_price: number; subtotal: number;
}

export interface Sale {
  id: string; total: number; paid: number; cost_total: number;
  payment_method: PaymentMethod; note: string | null; source: string;
  created_at: string; customer_name: string | null; seller_name: string | null;
  items: SaleItem[] | null;
}

export interface Debtor {
  customer_id: string; name: string; phone: string | null;
  balance: number; nearest_due: string | null; last_activity: string | null;
  overdue: boolean;
}

export interface DebtEntry {
  id: string; amount: number; due_date: string | null;
  note: string | null; created_at: string; sale_id: string | null; user_name: string | null;
}

/**
 * Kursor bilan sahifalangan ro'yxat. `next` — keyingi sahifa uchun
 * `?before=` qiymati; `null` bo'lsa ro'yxat tugagan va "Yana" ko'rsatilmaydi.
 */
export interface Sahifa<T> { items: T[]; next: string | null }

/** Xaridning bitta qatori — nima, qancha, qaysi narxda. */
export interface XaridQatori {
  name: string; qty: number; unit: Unit; unit_price: number; subtotal: number;
}

/** Omborga kirim qatori — nima, qancha, qaysi TAN NARXDA olindi. */
export interface KirimQatori {
  name: string; qty: number; unit: Unit; cost_price: number; subtotal: number;
}

/** `GET /purchases` — do'konga olingan tovar. Chiqim EMAS. */
export interface Kirim {
  id: string; supplier: string | null; total: number;
  note: string | null; source: string; created_at: string;
  user_name: string | null;
  items: KirimQatori[] | null;
}

/**
 * `GET /purchases/meta/aylanma` — "tovarga qo'ygan pulim qayerda?"
 *
 * `omborda` DAVRGA BOG'LIQ EMAS — u hozirgi qoldiqning tan narxdagi
 * qiymati. Qolgan uchtasi tanlangan davr bo'yicha.
 */
export interface TovarAylanma {
  /** Shu davrda tovarga sarflangan pul. */
  sarflandi: number;
  /** Shu davrda sotilgan molning tan narxi — pul bo'lib qaytgani. */
  sotilgan: number;
  /** Shu davrdagi savdo summasi (tan narx + foyda). */
  savdo: number;
  /** Hozir omborda turgan molning tan narxdagi qiymati. */
  omborda: number;
}

/** `GET /debts/customer/:id/purchases` */
export interface Xarid {
  id: string; total: number; paid: number;
  payment_method: PaymentMethod; created_at: string;
  items: XaridQatori[] | null;
}

/**
 * `GET /debts/customer/:id` — mijoz sahifasining birinchi so'rovi.
 * Xaridlar ro'yxati bu yerda YO'Q: undan faqat yig'indi (`jami`) keladi,
 * mahsulotlar bo'lim ochilganda alohida tortiladi.
 */
export interface CustomerDebt {
  customer_id: string; name: string; phone: string | null;
  balance: number; nearest_due: string | null;
  history: Sahifa<DebtEntry> | DebtEntry[];
  jami?: { xaridlar_soni: number; jami_xarid: number; oxirgi_xarid: string | null };
  /**
   * ESKI SERVER (1.9.0 gacha) shu javobning o'zida xaridlarni ham
   * yuborardi va `history` ni sahifa emas, oddiy massiv qilib qaytarardi.
   * Ilova do'kondagi telefonda serverdan oldin yangilanishi mumkin —
   * shuning uchun ikkala shakl ham tushuniladi.
   */
  purchases?: Xarid[];
}

export interface Expense {
  id: string; category: string; amount: number; note: string | null;
  source: string; created_at: string; updated_at: string;
  user_name: string | null;
}

/** `GET /expenses/meta/categories` — chip'lar shu tartibda chiqadi. */
export interface ExpenseCategory { name: string; count: number; total: number }

export interface Dashboard {
  today: {
    sales_total: number; cash_in: number; expense_total: number;
    net_profit: number; sales_count: number;
    /** Shu kuni sotilgan, lekin puli hali olinmagan summa */
    credit_total: number;
    /** `net_profit` ichidagi qarzda qolgan ulush — hali qo'lga tushmagan foyda */
    credit_profit: number;
    /**
     * Qo'lda yozilgan qarz (savdodan chiqmagani). Tushum va foydaga
     * kirmaydi — mol chiqmagan, tannarx yo'q.
     */
    debt_given: number;
    /**
     * Tovarga sarflangan pul (omborga kirim). Foydadan AYIRILMAYDI —
     * mol olish xarajat emas, pulning tovarga aylanishi; xarajatga u
     * sotilganda, tan narx bo'lib aylanadi. Bu yerda faqat "kassadan
     * shuncha chiqdi" degan ma'lumot.
     *
     * Ixtiyoriy: eski serverda bu maydon yo'q.
     */
    purchase_total?: number;
  };
  debts: { total_owed: number; debtor_count: number; overdue_count: number };
  low_stock: Array<{ id: string; name: string; stock: number; min_stock: number; unit: Unit }>;
  week: Array<{
    day: string; sales_total: number; expense_total: number;
    net_profit: number; credit_profit: number;
  }>;
}

/** AI tayyorlagan amal — foydalanuvchi tasdiqlagach bajariladi. */
export type AiAction =
  | { type: 'sale'; items: Array<{ product_id: string | null; name: string; unit: Unit; qty: number; unit_price: number }>;
      customer_id: string | null; customer_name: string | null;
      payment_method: PaymentMethod; paid: number | null; note: string | null }
  | { type: 'purchase'; supplier: string | null;
      items: Array<{ product_id: string | null; name: string; unit: Unit; qty: number; cost_price: number; sale_price: number | null }>;
      note: string | null }
  | { type: 'debt'; customer_id: string | null; customer_name: string; customer_phone: string | null;
      amount: number; due_date: string | null; note: string | null }
  | { type: 'debt_payment'; customer_id: string | null; customer_name: string; amount: number; note: string | null }
  | { type: 'expense'; category: string; amount: number; note: string | null }
  | { type: 'create_product'; name: string; unit: Unit; cost_price: number; sale_price: number;
      stock: number; category: string | null; barcode: string | null; photo_url: string | null }
  | { type: 'stock_adjust'; product_id: string; new_stock: number; note: string | null };

/**
 * Bir nom bir nechta mahsulotga to'g'ri kelganda ("kolbasa" → uchta kolbasa)
 * server bittasini o'zi tanlamaydi — hammasini shu ko'rinishda qaytaradi.
 */
export interface AiNomzod {
  id: string;
  name: string;
  /* mahsulot */
  unit?: Unit;
  sale_price?: number;
  cost_price?: number;
  stock?: number;
  photo_url?: string | null;
  /* mijoz */
  phone?: string | null;
  balance?: number;
}

export interface AiTanlov {
  /** `actions[]` indeksi. */
  amal: number;
  /** `items[]` indeksi; mijoz uchun -1. */
  qator: number;
  nima: 'mahsulot' | 'mijoz';
  /** Do'konchi yozgan so'z. */
  soralgan: string;
  /** Aniq moslik yo'q — bular o'xshashlari. */
  taxminiy: boolean;
  nomzodlar: AiNomzod[];
}

export interface AiCommandResponse {
  log_id: string;
  summary: string;
  actions: AiAction[];
  /** Tanlanishi kerak bo'lgan joylar. Bo'sh bo'lsa hammasi aniq. */
  choices: AiTanlov[];
  warnings: string[];
  needs_confirm: boolean;
  needs_choice: boolean;
  /** Ma'lumot yetishmasa — do'konchiga savol. */
  savol: string | null;
}

export interface VisionResponse {
  nom: string; kategoriya: string; birlik: Unit;
  brend: string | null; shtrix_kod: string | null;
  ishonch: number; izoh: string | null;
  mavjud: Array<{ id: string; name: string; unit: Unit; sale_price: number; stock: number }>;
}

/** Yangi mahsulot formasi uchun serverdan keladigan tayyor qiymatlar. */
export interface ProductDefaults {
  /** Do'konning odatdagi ustamasi, ulush ko'rinishida: 0.25 = +25%. */
  markup: number;
  /** Eng ko'p ishlatiladigan kategoriyalar — chip qilib ko'rsatiladi. */
  categories: string[];
}
