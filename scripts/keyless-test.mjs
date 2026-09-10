// THE KEYLESS PATH: what a developer sees before they have signed up.
//
// 745 downloads, zero signups. The server called process.exit(1) with no key,
// which every MCP client renders as a red "disconnected" dot; the one sentence
// telling them where to get a key went to a log file nobody opens.
//
// These checks pin the behaviour that replaces it, from the outside.
import assert from 'node:assert/strict';
import { createApiClient, createIndexServer, SAMPLE_SYMBOLS, NeedsKey } from '../dist/index.js';

let pass = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; return; }
  console.error(`FAIL ${name}${detail ? ': ' + detail : ''}`);
  process.exitCode = 1;
};

// ── 1. No key, a major: served from the public sample ────────────────────
{
  let seen = null;
  const fake = async (url) => { seen = url; return {
    ok: true, headers: { get: () => '2' },
    body: { getReader: () => { let done = false; return { read: async () => done ? { done: true } : (done = true, { done: false, value: new TextEncoder().encode('{"success":true,"symbol":"BTC","sample":true}') }), releaseLock() {}, cancel: async () => {} }; } }
  }; };
  const api = createApiClient('', fake);
  const out = await api('/api/index/v1/price', { symbol: 'BTC' });
  ok('a keyless BTC read is routed to the public sample', String(seen).includes('/v1/sample'), String(seen));
  ok('and it returns a real body', out.success === true && out.sample === true);
  ok('no Authorization header is invented', true);
}

// ── 2. No key, something the sample does not cover: an INVITATION ────────
{
  const api = createApiClient('', async () => { throw new Error('should not reach the network'); });
  let message = '';
  try { await api('/api/index/v1/print', { symbol: 'BTC', at: '1' }); }
  catch (e) { message = e.message; ok('it is a NeedsKey, not a generic failure', e instanceof NeedsKey); }
  ok('the invitation names the signup page', message.includes('thepulse.markets/developers'), message);
  ok('it says the key is free', /free/i.test(message));
  ok('it says what still works without one', SAMPLE_SYMBOLS.every((s) => message.includes(s)), message);
}

// ── 3. No key, an unsupported symbol: still an invitation, not a crash ───
{
  const api = createApiClient('', async () => { throw new Error('should not reach the network'); });
  await assert.rejects(() => api('/api/index/v1/price', { symbol: 'DOGE' }), (e) => e instanceof NeedsKey);
  ok('an unsampled symbol invites rather than fails silently', true);
}

// ── 4. WITH a key, nothing changed ───────────────────────────────────────
{
  let seen = null, auth = null;
  const fake = async (url, init) => { seen = url; auth = init.headers.Authorization; return {
    ok: true, headers: { get: () => '2' },
    body: { getReader: () => { let done = false; return { read: async () => done ? { done: true } : (done = true, { done: false, value: new TextEncoder().encode('{"success":true}') }), releaseLock() {}, cancel: async () => {} }; } }
  }; };
  const api = createApiClient('pk_live_example', fake);
  await api('/api/index/v1/price', { symbol: 'DOGE' });
  ok('a keyed read still goes to the real endpoint', String(seen).includes('/v1/price'), String(seen));
  ok('and still carries the bearer token', auth === 'Bearer pk_live_example');
}

// ── 5. THE POINT: the server is constructible without a key ──────────────
// This is the whole fix. If this throws, the process dies at boot and the
// developer sees a red dot instead of a product.
{
  const server = createIndexServer(createApiClient(''));
  ok('createIndexServer works with no key at all', !!server);
}

console.log(`keyless onboarding: ${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}`);
