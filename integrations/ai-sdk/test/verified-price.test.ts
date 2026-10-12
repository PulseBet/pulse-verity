import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { JSONRPCMessage, MCPTransport } from '@ai-sdk/mcp';
import { createVerifiedPriceTool, decodeResult, ExampleError, hostedTransport, MCP_URL, readVerifiedPrice } from '../verified-price.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/verity-agent-print.json', import.meta.url), 'utf8'));
const verified = { valid: true, recordValid: true, metadataSigned: true, verificationScope: 'full-record' };
type Mode = 'success' | 'text' | 'missing' | 'duplicate' | 'read-error' | 'quota' | 'reject' | 'legacy' | 'wrong-symbol' | 'malformed' | 'abort' | 'init-error' | 'throw';

// Real AI SDK tool + real MCP client, in-memory JSON-RPC peer. No network/LLM.
class Peer implements MCPTransport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  closed = false;
  calls: { name: string; arguments?: Record<string, unknown> }[] = [];
  controller?: AbortController;
  mode: Mode;
  constructor(mode: Mode = 'success') { this.mode = mode; }
  async start() {}
  async close() { this.closed = true; this.onclose?.(); }
  async send(message: JSONRPCMessage) {
    if (!('id' in message) || !('method' in message)) return;
    let result: Record<string, unknown>;
    if (message.method === 'initialize') {
      if (this.mode === 'init-error') throw new Error('synthetic confidential header');
      result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-peer', version: '1' } };
    } else if (message.method === 'tools/list') {
      const names = this.mode === 'missing' ? ['get_index_price'] : ['get_index_price', 'verify_print', 'submit_api_feedback'];
      if (this.mode === 'duplicate') names.push('verify_print');
      result = { tools: names.map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) };
    } else if (message.method === 'tools/call') {
      const params = message.params as { name: string; arguments: Record<string, unknown> };
      this.calls.push(params);
      if (this.mode === 'throw') throw new Error('synthetic confidential token');
      if (this.mode === 'abort') { this.controller!.abort(); return; }
      let body: Record<string, unknown>;
      if (params.name === 'get_index_price') {
        assert.deepEqual(params.arguments, { symbol: 'BTC' });
        body = structuredClone(fixture.print);
        if (this.mode === 'wrong-symbol') body.symbol = 'ETH';
        if (this.mode === 'malformed') body.price = 0;
        if (this.mode === 'quota') body = { error: { code: 'RATE_LIMITED', message: 'synthetic confidential detail' } };
      } else {
        assert.equal(params.name, 'verify_print');
        assert.deepEqual(params.arguments, fixture.print, 'exact signed record must survive transport');
        body = { ...verified };
        if (this.mode === 'reject') body.recordValid = false;
        if (this.mode === 'legacy') { body.metadataSigned = false; body.verificationScope = 'price-only'; }
      }
      result = this.mode === 'text' ? { content: [{ type: 'text', text: JSON.stringify(body) }] }
        : { content: [], structuredContent: body };
      if (this.mode === 'read-error') result.isError = true;
    } else throw new Error('Unexpected method');
    queueMicrotask(() => this.onmessage?.({ jsonrpc: '2.0', id: message.id, result }));
  }
}

for (const mode of ['success', 'text'] as const) {
  test(`real SDK tool executes read + exact-record verification (${mode}) and closes`, async () => {
    const peer = new Peer(mode);
    const priceTool = createVerifiedPriceTool(() => peer);
    const value = await priceTool.execute({ symbol: 'btc' }, { toolCallId: 'test', messages: [] });
    assert.equal(value.recordValid, true);
    assert.equal(value.priceText, fixture.print.priceText);
    assert.equal(value.freshnessAssessed, false, 'historical fixture must not be described as fresh');
    assert.deepEqual(peer.calls.map(c => c.name), ['get_index_price', 'verify_print']);
    assert.equal(peer.closed, true);
  });
}

for (const [mode, count] of [
  ['missing', 0], ['duplicate', 0], ['read-error', 1], ['quota', 1],
  ['wrong-symbol', 1], ['malformed', 1], ['reject', 2], ['legacy', 2], ['throw', 1],
] as const) {
  test(`rejects ${mode}, never retries or calls feedback, closes`, async () => {
    const peer = new Peer(mode);
    await assert.rejects(readVerifiedPrice(() => peer, 'BTC'), error => {
      assert.ok(error instanceof ExampleError);
      assert.doesNotMatch(error.message, /confidential/);
      return true;
    });
    assert.equal(peer.calls.length, count);
    assert.equal(peer.closed, true);
  });
}

test('initialization failure closes transport through SDK lifecycle', async () => {
  const peer = new Peer('init-error');
  await assert.rejects(readVerifiedPrice(() => peer, 'BTC'), ExampleError);
  assert.equal(peer.closed, true);
});

test('caller cancellation stops pending request and closes without a second call', async () => {
  const peer = new Peer('abort');
  peer.controller = new AbortController();
  await assert.rejects(readVerifiedPrice(() => peer, 'BTC', peer.controller.signal), ExampleError);
  assert.equal(peer.calls.length, 1);
  assert.equal(peer.closed, true);
});

test('invalid ticker rejected before opening a connection', async () => {
  let opened = false;
  await assert.rejects(readVerifiedPrice(() => { opened = true; return new Peer(); }, 'BTC/USD'), ExampleError);
  assert.equal(opened, false);
});

test('hosted transport has a fixed HTTPS origin and rejects malformed credentials', () => {
  assert.deepEqual(hostedTransport('synthetic-test-key'), {
    type: 'http', url: MCP_URL, headers: { Authorization: 'Bearer synthetic-test-key' },
  });
  for (const key of [undefined, '', 'x\ny', 'x'.repeat(4097)]) assert.throws(() => hostedTransport(key), ExampleError);
});

test('ambiguous, oversized and misleading envelopes are rejected', () => {
  for (const result of [
    { content: [] }, { content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] },
    { content: [{ type: 'text', text: '[]' }] }, { content: [{ type: 'text', text: 'not-json' }] },
    { content: [{ type: 'text', text: 'x'.repeat(1024 * 1024 + 1) }] },
    { structuredContent: { data: 'x'.repeat(1024 * 1024) } },
    { isError: true, structuredContent: verified }, { structuredContent: { success: false } },
  ]) assert.throws(() => decodeResult(result), ExampleError);
});

test('real HTTP transport authenticates only at the fixed endpoint and surfaces refusal safely', async () => {
  const config = hostedTransport('synthetic-test-key');
  assert.ok('type' in config);
  const requests: string[] = [];
  const transport = { ...config, fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init?.method ?? 'GET');
    assert.equal(String(url), MCP_URL);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-test-key');
    return new Response('synthetic confidential body', { status: 403 });
  } };
  await assert.rejects(readVerifiedPrice(() => transport, 'BTC'), error => {
    assert.ok(error instanceof ExampleError);
    assert.doesNotMatch(error.message, /confidential|synthetic-test-key/);
    return true;
  });
  // Legacy transport opens an inbound SSE GET separately from initialize POST.
  assert.deepEqual(requests.sort(), ['GET', 'POST']);
});
