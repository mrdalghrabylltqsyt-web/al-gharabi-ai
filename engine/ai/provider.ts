/**
 * موصل مزود Google Gen AI.
 *
 * المفتاح يُقرأ من بيئة الخادم فقط ولا يظهر أبداً في أي استجابة أو سجل.
 * إعادة المحاولة الافتراضية في الـSDK معطلة (attempts=1) لأن محرك الغرابي
 * يدير إعادة المحاولة بنفسه ويعرف أي الأخطاء يستحق المحاولة.
 */

import { GoogleGenAI } from '@google/genai';
import type { AiProvider } from './engine';

export interface GeminiProviderOptions {
  apiKey: string;
  timeoutMs?: number;
}

export class GeminiProvider implements AiProvider {
  readonly name = 'google-genai';
  private readonly client: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        timeout: this.timeoutMs,
        headers: { 'User-Agent': 'al-gharabi-ai' },
        retryOptions: { attempts: 1 },
      },
    });
  }

  async generate(input: { model: string; prompt: string; json?: boolean; signal?: AbortSignal }): Promise<string> {
    const response = await this.client.models.generateContent({
      model: input.model,
      contents: input.prompt,
      config: {
        ...(input.json ? { responseMimeType: 'application/json' } : {}),
        // تمرير إشارة الإلغاء يحرّر الطلب المعلّق محلياً عند انتهاء مهلة المحرك.
        // ملاحظة من الـSDK: الإلغاء لا يوقف المعالجة على خدمة المزود، لذا يبقى
        // تقليل عدد الطلبات (حارس الحصة + قاطع الدائرة) هو خط الدفاع عن الحصة.
        ...(input.signal ? { abortSignal: input.signal } : {}),
      },
    });
    return response.text || '';
  }
}

/** ينشئ المزود إن كان المفتاح متاحاً على الخادم؛ وإلا يعيد null للعمل حتمياً. */
export function createGeminiProvider(apiKey: string | undefined, timeoutMs?: number): GeminiProvider | null {
  const key = (apiKey || '').trim();
  if (!key) return null;
  try {
    return new GeminiProvider({ apiKey: key, timeoutMs });
  } catch {
    return null;
  }
}
