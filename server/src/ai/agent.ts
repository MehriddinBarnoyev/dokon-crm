/**
 * BUYRUQ OQIMI
 * =============
 *   matn → extractCommand()  — BITTA Groq chaqiruvi, faqat JSON ga o'girish
 *        → resolveCommand()  — sof SQL: nomni bazadagi mahsulotga bog'lash
 *        → tasdiqlash        → /ai/execute tranzaksiyada yozadi
 *
 * AI bazani ko'rmaydi. Qidiruv, narx, qoldiq — hammasi bazadan.
 * Shu sabab:
 *   • bitta buyruq = bitta Groq chaqiruvi (~700 token, oldin ~11 500 edi);
 *   • ekrandagi qidiruv bilan buyruqdagi qidiruv AYNAN bir xil funksiya;
 *   • bir nom bir necha mahsulotga to'g'ri kelsa ("kolbasa"), AI o'zicha
 *     bittasini tanlamaydi — hammasi do'konchiga ro'yxat bo'lib chiqadi.
 */
import type { Action } from '../lib/actions.js';
import { extractCommand } from './extract.js';
import { resolveCommand, type Tanlov } from '../lib/resolve.js';

export interface ParseResult {
  summary: string;
  actions: Action[];
  /** Do'konchi tanlashi kerak bo'lgan joylar (bir nechta moslik topilgan). */
  tanlovlar: Tanlov[];
  warnings: string[];
  needsConfirm: boolean;
  needsChoice: boolean;
  savol: string | null;
  usage: { input: number; output: number };
}

export async function parseCommand(shopId: string, text: string): Promise<ParseResult> {
  const { xom, usage } = await extractCommand(text);
  const { actions, tanlovlar, warnings, summary } = await resolveCommand(shopId, xom);

  return {
    summary,
    actions,
    tanlovlar,
    warnings,
    needsConfirm: actions.length > 0,
    needsChoice: tanlovlar.length > 0,
    savol: xom.savol,
    usage,
  };
}
