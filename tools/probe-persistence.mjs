#!/usr/bin/env node
/**
 * أداة تحقق يدوية من ثبات سجلات السوشيال بعد إعادة تشغيل الحاوية.
 *
 * لا تُشغَّل من الاختبارات ولا من final-audit: تُشغَّل يدوياً على نشر حقيقي.
 *   APP_URL=https://... OWNER_TOKEN=... node tools/probe-persistence.mjs
 *
 * لا تُخزَّن الأسرار ولا تُطبع. الإخراج لا يحوي إلا معرّفات التحقق وأحكامه.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const OWNER_TOKEN = process.env.OWNER_TOKEN || '';
const PLATFORM = process.env.PROBE_PLATFORM || 'facebook';
const EXTERNAL_ID = `TEST_PROBE_${Date.now()}`;
const TEXT = 'TEST_PROBE_ — سجل تحقق يدوي من الثبات. لا يمثل تعليقاً حقيقياً.';

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, body) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${OWNER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

async function readComment() {
  const { status, ok, json } = await api(
    'GET',
    `/api/social/manager/comments?platform=${encodeURIComponent(PLATFORM)}`,
  );
  if (!ok || !json || !Array.isArray(json.comments)) {
    return { status, found: false, comment: null };
  }
  const comment = json.comments.find((c) => c.externalId === EXTERNAL_ID) || null;
  return { status, found: Boolean(comment), comment };
}

function preflight() {
  if (!APP_URL) {
    console.error('FATAL — APP_URL غير مضبوط.');
    process.exit(2);
  }
  if (!OWNER_TOKEN) {
    console.error('FATAL — OWNER_TOKEN غير مضبوط.');
    process.exit(2);
  }
}

async function main() {
  preflight();
  const target = new URL(APP_URL);
  console.log(`Persistence Probe — target host: ${target.host}`);
  console.log(`platform=${PLATFORM} externalId=${EXTERNAL_ID}`);
  console.log('');

  // 1) إدخال سجل التحقق
  const ingest1 = await api('POST', '/api/social/manager/comments/ingest', {
    platform: PLATFORM,
    externalId: EXTERNAL_ID,
    text: TEXT,
    authorName: 'TEST_PROBE',
  });
  record(
    'ingest-accepted',
    ingest1.ok && ingest1.json?.success === true && ingest1.json?.duplicate !== true,
    `http=${ingest1.status}`,
  );

  // 2) ثبات قبل إعادة التشغيل
  const before = await readComment();
  record('persist-before-restart', before.found, `http=${before.status} found=${before.found}`);

  // 3) توقّف يدوي لإعادة تشغيل الحاوية
  console.log('');
  console.log('ACTION REQUIRED — أعد تشغيل حاوية Back4App يدوياً الآن (Restart/Deploy).');
  const rl = createInterface({ input, output });
  await rl.question('ثم اضغط Enter للمتابعة...');
  rl.close();

  // 4) الثبات بعد إعادة التشغيل
  const after = await readComment();
  record('survives-restart', after.found, `http=${after.status} found=${after.found}`);
  const sameId =
    before.comment && after.comment && before.comment.id === after.comment.id;
  record('identity-stable-after-restart', sameId, sameId ? 'معرّف السجل لم يتغير' : 'معرّف مختلف أو سجل مفقود');

  // 5) حماية التكرار / replay بنفس المعرّف الخارجي
  const ingest2 = await api('POST', '/api/social/manager/comments/ingest', {
    platform: PLATFORM,
    externalId: EXTERNAL_ID,
    text: TEXT,
    authorName: 'TEST_PROBE',
  });
  const duplicateFlag = ingest2.json?.duplicate === true;
  const sameComment = ingest2.json?.comment?.id && ingest2.json.comment.id === after.comment?.id;
  record('replay-protection', ingest2.ok && duplicateFlag && sameComment, `http=${ingest2.status} duplicate=${duplicateFlag}`);

  const third = await readComment();
  const { status: cStatus, json: cJson } = await api(
    'GET',
    `/api/social/manager/comments?platform=${encodeURIComponent(PLATFORM)}`,
  );
  const occurrences =
    cStatus === 200 && Array.isArray(cJson?.comments)
      ? cJson.comments.filter((c) => c.externalId === EXTERNAL_ID).length
      : -1;
  record('no-duplicate-row', occurrences === 1, `rows=${occurrences}`);

  // 6) التقرير النهائي
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  console.log('=== PERSISTENCE PROBE REPORT ===');
  console.log(`externalId: ${EXTERNAL_ID}`);
  console.log(`commentId: ${third.comment?.id ?? 'n/a'}`);
  console.log(`checks: ${passed}/${results.length} passed`);
  for (const r of results) {
    console.log(`  - ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  }
  console.log(`verdict: ${failed === 0 ? 'PERSISTENCE VERIFIED' : 'PERSISTENCE NOT VERIFIED'}`);
  console.log('================================');
}

main().catch((err) => {
  console.error(`FATAL — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
