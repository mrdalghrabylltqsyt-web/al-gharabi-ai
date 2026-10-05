/**
 * إعداد Playwright لاختبار e2e واحد على الأقل (M3).
 *
 * ملاحظة تشغيلية: الاختبار **منفصل عن `npm test`** (لا يعمل في CI الحالي بلا
 * متصفح مثبّت) ويُشغَّل عبر `npm run test:e2e`. يستخدم Chromium المثبّت على
 * النظام إن وُجد (`/usr/bin/chromium`) فلا يلزم تنزيل متصفح Playwright؛ ويمكن
 * تحديد مسار مخصص عبر `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
 *
 * يقلع الخادم نفسه عبر `webServer` (tsx server.ts) بمجلد حالة مؤقت وتوكن معاينة
 * اختباري — بلا لمس حالة الإنتاج ولا أي مزود خارجي.
 */
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT || 4521);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = process.env.E2E_PREVIEW_TOKEN || 'e2e-preview-token-0123456789abcdef';
const STATE_DIR = process.env.E2E_STATE_DIR || path.join(os.tmpdir(), 'gharabi-e2e-state');

const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default defineConfig({
  testDir: path.join(process.cwd(), 'engine', 'e2e'),
  testMatch: /.*\.e2e\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    launchOptions: {
      executablePath: systemChromium,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'tsx server.ts',
    url: `${BASE_URL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      APP_URL: BASE_URL,
      GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
      SESSION_SECRET: 'e2e-session-secret-not-real',
      STATE_DIR,
      OWNER_EMAIL: process.env.OWNER_EMAIL || 'e2e-owner@example.com',
      GEMINI_API_KEY: '',
      DATABASE_URL: '',
    },
  },
});
