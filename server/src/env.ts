import 'dotenv/config';

function need(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === '') throw new Error(`.env da ${key} ko'rsatilmagan`);
  return v;
}

export const env = {
  databaseUrl: need('DATABASE_URL', 'postgres://dokon:dokon_secret@127.0.0.1:5433/dokon'),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: need('JWT_SECRET', 'dev_secret_almashtiring'),

  // --- HTTPS ---
  // Ikkalasi ham ko'rsatilsa server TLS bilan ko'tariladi, aks holda oddiy HTTP.
  // Sertifikat yaratish: npm run cert
  tlsKey: process.env.TLS_KEY ?? '',
  tlsCert: process.env.TLS_CERT ?? '',
  get httpsEnabled() {
    return this.tlsKey.length > 0 && this.tlsCert.length > 0;
  },

  // --- Groq ---
  // Bir nechta kalit vergul bilan yozilishi mumkin. E'TIBOR: Groq limitni
  // AKKAUNTGA qo'yadi — bitta akkauntning kalitlari bir byudjetni bo'lishadi.
  // Almashinuv faqat kalitlar har xil akkauntdan bo'lsa foyda beradi.
  get groqKeys(): string[] {
    return (process.env.GROQ_API_KEY ?? '')
      .split(',').map((k) => k.trim()).filter(Boolean);
  },
  get groqKey(): string {
    return this.groqKeys[0] ?? '';
  },
  /** Tool calling ishlaydigan model (buyruq agenti, tahlil). */
  groqTextModel: process.env.GROQ_TEXT_MODEL ?? 'openai/gpt-oss-120b',
  /** Rasm qabul qiladigan model. Groq'da faqat qwen oilasi. */
  groqVisionModel: process.env.GROQ_VISION_MODEL ?? 'qwen/qwen3.8-27b',

  get aiEnabled() {
    return this.groqKeys.length > 0;
  },
};
