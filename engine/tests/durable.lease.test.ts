/**
 * PROC-01 — اختبار وحدة لقفل الدوام (durable lease).
 * منطق صافٍ: لا استيلاء على قفل حيّ، استرداد المتقادم، إفراج المالك فقط، تطبيع آمن.
 */
import {
  acquireLease,
  releaseLease,
  isLeaseStale,
  normalizeLease,
  LEASE_MIN_TTL_MS,
  LEASE_MAX_TTL_MS,
  type DurableLease,
} from '../social/durableLease';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const NOW = 1_000_000_000_000;

// أخذ قفل بلا قفل سابق.
{
  const r = acquireLease(null, { owner: 'a', nowMs: NOW, ttlMs: 60_000 });
  check('acquire when free', r.acquired && r.lease?.owner === 'a' && !r.recovered);
  check('lease expiry = now + ttl', r.lease?.expiresAtMs === NOW + 60_000);
}

// قفل حيّ لمالك آخر يُرفض بلا استيلاء.
{
  const held: DurableLease = { owner: 'a', acquiredAtMs: NOW, expiresAtMs: NOW + 60_000 };
  const r = acquireLease(held, { owner: 'b', nowMs: NOW + 1000, ttlMs: 60_000 });
  check('live lease is not stolen', !r.acquired && r.lease?.owner === 'a' && !r.recovered);
}

// قفل متقادم يُستردّ.
{
  const stale: DurableLease = { owner: 'a', acquiredAtMs: NOW, expiresAtMs: NOW + 1000 };
  const r = acquireLease(stale, { owner: 'b', nowMs: NOW + 5000, ttlMs: 60_000 });
  check('stale lease recovered', r.acquired && r.recovered && r.lease?.owner === 'b');
  check('isLeaseStale true past expiry', isLeaseStale(stale, NOW + 5000));
  check('isLeaseStale false before expiry', !isLeaseStale(stale, NOW + 500));
}

// ttl مقيّد بالحدود.
{
  const small = acquireLease(null, { owner: 'a', nowMs: NOW, ttlMs: 1 });
  check('ttl clamped to min', small.lease?.expiresAtMs === NOW + LEASE_MIN_TTL_MS);
  const big = acquireLease(null, { owner: 'a', nowMs: NOW, ttlMs: 999 * 60 * 60 * 1000 });
  check('ttl clamped to max', big.lease?.expiresAtMs === NOW + LEASE_MAX_TTL_MS);
}

// الإفراج فقط للمالك.
{
  const held: DurableLease = { owner: 'a', acquiredAtMs: NOW, expiresAtMs: NOW + 60_000 };
  const other = releaseLease(held, 'b');
  check('non-owner cannot release', !other.released && other.lease?.owner === 'a');
  const own = releaseLease(held, 'a');
  check('owner releases', own.released && own.lease === null);
  check('release null is safe', releaseLease(null, 'a').released === false);
}

// تطبيع آمن للقفل المسترجَع.
{
  check('normalize valid', normalizeLease({ owner: 'x', acquiredAtMs: 1, expiresAtMs: 2 })?.owner === 'x');
  check('normalize missing owner -> null', normalizeLease({ acquiredAtMs: 1, expiresAtMs: 2 }) === null);
  check('normalize non-numeric -> null', normalizeLease({ owner: 'x', acquiredAtMs: 'a', expiresAtMs: 2 }) === null);
  check('normalize junk -> null', normalizeLease(null) === null && normalizeLease('nope' as any) === null);
}

console.log(`PASSED: ${passed} durable-lease checks`);
if (failures.length) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
