/** Offline regression tests; all API responses are synthetic and keys ephemeral. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  canonicalPricePayload, verifySignature, INDEX_SIG_VERSION, SERVER_VERSION,
  PublicKeyCache, KEY_CACHE_TTL_MS, KEY_REFRESH_COOLDOWN_MS, MAX_VERIFICATION_KEYS,
  createApiClient, createIndexServer, ApiFailure, API_BASE, MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS, describeApiError, redactCredentials
} from "./index.js";
import type { VerifiablePrint, ApiClient } from "./index.js";

let passed = 0;
function ok(condition: unknown, message: string): void { assert.ok(condition, message); passed += 1; }
async function rejects(action: () => Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(action, message); passed += 1;
}
function keyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { privateKey, pem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
const old = keyPair();
const current = keyPair();
const print = { symbol: "BTC", price: "65123.45", at: "2026-08-27T10:00:00.000Z", grade: "composite" };
function signed(value: Omit<VerifiablePrint, "signature">, key = old.privateKey): VerifiablePrint {
  return { ...value, signature: crypto.sign("sha256", Buffer.from(canonicalPricePayload(value)),
    { key, dsaEncoding: "ieee-p1363" }).toString("base64") };
}
const receipt = signed(print);
const exactReceipt = signed({ ...print, price: 1.23, priceText: "1.230000", kid: "old" });
const latestReceipt = signed({ ...print, kid: "current" }, current.privateKey);
const ring = {
  activeKid: "current", publicKeyPem: current.pem,
  verificationKeys: [{ kid: "current", pem: current.pem }, { kid: "old", pem: old.pem }]
};

ok(canonicalPricePayload(print) === INDEX_SIG_VERSION + "\nBTC\n65123.45\n2026-08-27T10:00:00.000Z\ncomposite",
  "canonical payload preserves the immutable v1 layout");
ok(canonicalPricePayload({ ...print, price: 65123.45 }) === canonicalPricePayload(print),
  "legacy number and matching exact string canonicalize identically");
ok(verifySignature(receipt, old.pem), "genuine legacy print verifies");
ok(verifySignature(exactReceipt, old.pem), "priceText retains trailing decimal zeros lost in the numeric price");
ok(verifySignature(signed({ ...print, price: 1e-8, priceText: "0.0000000100" }), old.pem),
  "priceText preserves tiny decimal representation instead of JS exponent rendering");
ok(!verifySignature({ ...exactReceipt, priceText: "1.23" }, old.pem), "reformatting exact priceText fails");
ok(!verifySignature({ ...exactReceipt, price: 1.24 }, old.pem), "conflicting display price cannot pass verification");
for (const [field, value] of Object.entries({ price: "65123.46", symbol: "ETH", at: "2026-08-27T10:00:01.000Z", grade: "blended" })) {
  ok(!verifySignature({ ...receipt, [field]: value }, old.pem), "tampering with " + field + " fails");
}
ok(!verifySignature(receipt, current.pem), "wrong public key fails");
ok(!verifySignature({ ...receipt, signature: receipt.signature.slice(0, -4) + "AAAA" }, old.pem), "corrupted signature fails");
ok(!verifySignature({ ...receipt, signature: "bm90LWEtc2ln" }, old.pem), "short signature fails without throwing");
ok(!verifySignature({ ...receipt, signature: receipt.signature + "\n" }, old.pem), "base64 whitespace is rejected");
for (const field of ["symbol", "at", "grade", "price"] as const) {
  ok(!verifySignature({ ...receipt, [field]: String(receipt[field]) + "\nextra" }, old.pem),
    "control delimiters in " + field + " are rejected");
}
for (const price of [Infinity, -Infinity, NaN, "Infinity", "1e999", "0x10", "", "1".repeat(101)]) {
  ok(!verifySignature({ ...receipt, price }, old.pem), "non-finite or malformed price is rejected");
}
ok(!verifySignature({ ...receipt, sig: "unsupported" as typeof INDEX_SIG_VERSION }, old.pem), "unsupported supplied signature version is rejected");
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
ok(!verifySignature(receipt, rsa.publicKey.export({ type: "spki", format: "pem" }).toString()), "non-P256 verification keys are rejected");

let clock = 0;
let loads = 0;
let document: unknown = { activeKid: "old", publicKeyPem: old.pem, verificationKeys: [{ kid: "old", pem: old.pem }] };
const cache = new PublicKeyCache(async () => { loads += 1; return document; }, () => clock);
ok((await cache.verify(exactReceipt)).verifiedWithKid === "old" && loads === 1, "explicit historical kid selects its exact key");
document = ring;
ok(!(await cache.verify(latestReceipt)).valid && loads === 1, "unknown kid cannot cause a refresh storm");
clock += KEY_REFRESH_COOLDOWN_MS;
ok((await cache.verify(latestReceipt)).verifiedWithKid === "current" && loads === 2, "rotation refresh admits the new published kid");
ok((await cache.verify(receipt)).verifiedWithKid === "old", "legacy print without kid can verify against retained history");
ok(!(await cache.verify({ ...latestReceipt, kid: "missing" })).valid, "unknown kid never falls back to active key");
ok(!(await cache.verify({ ...latestReceipt, kid: "old" })).valid, "known but wrong kid never falls back to another key");
document = { activeKid: "current", publicKeyPem: current.pem, verificationKeys: [{ kid: "current", pem: current.pem }] };
clock += KEY_CACHE_TTL_MS;
ok(!(await cache.verify(exactReceipt)).valid && loads === 3, "expired cached history cannot keep a removed key alive");
const legacyCache = new PublicKeyCache(async () => ({ publicKeyPem: old.pem }));
ok((await legacyCache.verify(receipt)).valid, "legacy single-key document remains supported");
ok(!(await legacyCache.verify({ ...receipt, kid: "old" })).valid, "legacy unlabelled key cannot satisfy an explicit kid");
let legacyClock = 0;
let legacyDocument: unknown = { publicKeyPem: old.pem };
let legacyLoads = 0;
const rotatingLegacy = new PublicKeyCache(async () => { legacyLoads += 1; return legacyDocument; }, () => legacyClock);
await rotatingLegacy.verify(receipt);
legacyDocument = { publicKeyPem: current.pem };
legacyClock += KEY_REFRESH_COOLDOWN_MS;
ok((await rotatingLegacy.verify({ ...latestReceipt, kid: undefined })).valid && legacyLoads === 2,
  "legacy receipt mismatch refreshes the key after rotation");

let sharedLoads = 0;
const sharedCache = new PublicKeyCache(async () => { sharedLoads += 1; return ring; });
const concurrent = await Promise.all(Array.from({ length: 12 }, () => sharedCache.verify(latestReceipt)));
ok(concurrent.every((result) => result.valid) && sharedLoads === 1, "concurrent verification coalesces public-key requests");
for (const malformed of [
  {}, { verificationKeys: Array.from({ length: MAX_VERIFICATION_KEYS + 1 }, (_, n) => ({ kid: String(n), pem: old.pem })) },
  { verificationKeys: [{ kid: "old", pem: old.pem }, { kid: "old", pem: old.pem }] },
  { ...ring, publicKeyPem: old.pem }, { publicKeyPem: "not a key" },
  { publicKeyPem: rsa.publicKey.export({ type: "spki", format: "pem" }).toString() }
]) {
  await rejects(() => new PublicKeyCache(async () => malformed).verify(receipt), "malformed or unbounded key document fails closed");
}
let failingLoads = 0;
let expiryClock = 0;
const expiring = new PublicKeyCache(async () => {
  failingLoads += 1;
  if (failingLoads > 1) throw new Error("Synthetic unavailable key document");
  return ring;
}, () => expiryClock);
await expiring.verify(receipt);
expiryClock += KEY_CACHE_TTL_MS;
await rejects(() => expiring.verify(receipt), "failed expired-key refresh fails closed");
await rejects(() => expiring.verify(receipt), "failed refresh cooldown does not reuse expired keys");
ok(failingLoads === 2, "failed refresh is rate bounded");
const noFetch = new PublicKeyCache(async () => { throw new Error("Must not fetch"); });
await rejects(() => noFetch.verify({ ...exactReceipt, price: 5 }), "inconsistent input rejected before public-key I/O");

const fakeKey = "pidx_SYNTHETIC_TEST_CREDENTIAL";
const requests: Array<{ url: string; options: RequestInit }> = [];
const fetcher: typeof fetch = async (url, options) => {
  requests.push({ url: String(url), options: options ?? {} });
  return new Response(JSON.stringify({ price: 1.23, echo: fakeKey, nested: ["Bearer synthetic-other"] }));
};
const api = createApiClient(fakeKey, fetcher);
const response = await api("/api/index/v1/price", { symbol: "BTC&other=x" });
ok(requests[0].url === API_BASE + "/api/index/v1/price?symbol=BTC%26other%3Dx", "origin is pinned and query parameters encoded");
ok(requests[0].options.method === "GET" && requests[0].options.redirect === "error", "requests stay read-only and reject redirects");
ok(new Headers(requests[0].options.headers).get("authorization") === "Bearer " + fakeKey, "keyed request uses configured credential");
ok(requests[0].options.signal instanceof AbortSignal && REQUEST_TIMEOUT_MS === 15000, "request carries the bounded timeout signal");
ok(!JSON.stringify(response).includes(fakeKey) && !JSON.stringify(response).includes("synthetic-other"), "nested response credentials are redacted");
await api("/api/index/v1/pubkey");
ok(!new Headers(requests[1].options.headers).has("authorization"), "public-key fetch omits authorization");
await rejects(() => api("https://unrelated.invalid/" as Parameters<ApiClient>[0]), "arbitrary API destination is rejected");
ok(requests.length === 2, "rejected path never reaches transport");
const escaped = createApiClient(fakeKey, async () => new Response('{"secret":"pidx_SYNTHETIC_TEST_CREDENTI\\u0041L"}'));
ok(!JSON.stringify(await escaped("/api/index/v1/price")).includes(fakeKey), "JSON escapes cannot bypass credential redaction");
await rejects(() => createApiClient("")("/api/index/v1/price"), "keyed request fails before network without a key");
await rejects(() => createApiClient(fakeKey + "\n", fetcher)("/api/index/v1/price"), "credential header controls are rejected");
ok(redactCredentials(fakeKey + " Bearer private", fakeKey) === "[REDACTED] Bearer [REDACTED]", "credential scrubber removes exact and bearer values");
for (const status of [400, 401, 403, 404, 429, 503]) {
  try {
    await createApiClient(fakeKey, async () => new Response(fakeKey, { status }))("/api/index/v1/price");
    assert.fail("Expected API rejection");
  } catch (error) {
    ok(error instanceof ApiFailure && error.status === status && !describeApiError(error).includes(fakeKey),
      "HTTP " + status + " stays an error without exposing upstream bodies");
  }
}
ok(!describeApiError(new Error("transport leaked " + fakeKey)).includes(fakeKey), "raw transport errors cannot expose credentials");
await rejects(() => createApiClient(fakeKey, async () => new Response("{}", {
  headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) }
}))("/api/index/v1/price"), "oversized advertised body is rejected");
let cancelled = false;
const oversized = new ReadableStream<Uint8Array>({
  start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES)); controller.enqueue(new Uint8Array(1)); },
  cancel() { cancelled = true; }
});
await rejects(() => createApiClient(fakeKey, async () => new Response(oversized))("/api/index/v1/price"),
  "oversized streamed body is rejected without trusting content-length");
ok(cancelled, "oversized stream is cancelled");
for (const body of ["not-json", "[]", "null", '{"price":1e999}', '{"a":'.repeat(32) + "0" + "}".repeat(32)]) {
  await rejects(() => createApiClient(fakeKey, async () => new Response(body))("/api/index/v1/price"),
    "invalid, non-finite or deeply nested response is rejected");
}

// Exercise the actual MCP transport and schemas, not only implementation helpers.
const calls: Array<{ path: string; params: Record<string, string> }> = [];
const signedRow = { ...exactReceipt, tier: "consensus", confidence: 0.8, interval: { lower: 1.2, upper: 1.3 } };
const server = createIndexServer(async (path, params = {}) => {
  calls.push({ path, params });
  if (path === "/api/index/v1/pubkey") return ring;
  if (path === "/api/index/v1/price" || path === "/api/index/v1/print") return signedRow;
  if (path === "/api/index/v1/batch") return { observations: [signedRow, { symbol: "BAD", success: false, code: "STALE" }] };
  return { total: 1, count: 1, rows: [{ symbol: "BTC", status: "consensus" }] };
});
const client = new Client({ name: "offline-selftest", version: SERVER_VERSION });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
try {
  ok(client.getServerVersion()?.version === SERVER_VERSION, "MCP handshake reports the release version");
  const { tools } = await client.listTools();
  ok(tools.length === 5 && ["get_index_price", "get_index_batch", "list_index_assets", "get_settlement_print", "verify_print"]
    .every((name) => tools.some((tool) => tool.name === name)), "existing tool names remain and exactly two bounded read tools are added");
  ok(tools.every((tool) => tool.annotations?.readOnlyHint && tool.annotations?.destructiveHint === false),
    "all advertised MCP tools are read-only");
  const priceResult = await client.callTool({ name: "get_index_price", arguments: { symbol: "BTC" } });
  const priceOutput = priceResult.structuredContent as Record<string, unknown>;
  ok(priceOutput.priceText === "1.230000" && priceOutput.confidence === 0.8,
    "signed endpoint result preserves receipt and optional quality fields");
  const batch = await client.callTool({ name: "get_index_batch", arguments: { symbols: ["btc", "BTC", "BAD"] } });
  ok(calls.at(-1)?.path === "/api/index/v1/batch" && calls.at(-1)?.params.symbols === "BTC,BAD", "batch uses existing signed endpoint and deduplicates input");
  const batchOutput = batch.structuredContent as Record<string, unknown>;
  ok(Array.isArray(batchOutput.observations) && batchOutput.observations.length === 2, "per-symbol errors survive alongside successful rows");
  await client.callTool({ name: "list_index_assets", arguments: {} });
  ok(calls.at(-1)?.params.limit === "50" && calls.at(-1)?.params.offset === "0", "catalog has bounded default pagination");
  await client.callTool({ name: "list_index_assets", arguments: { limit: 100, offset: 100000, band: "ten-second", status: "blended" } });
  ok(calls.at(-1)?.path === "/api/index/v1/verity/catalog" && calls.at(-1)?.params.band === "ten-second",
    "catalog filters use the detailed keyed endpoint");
  await client.callTool({ name: "get_settlement_print", arguments: { symbol: "BTC", at: "1787911200000" } });
  ok(calls.at(-1)?.path === "/api/index/v1/print", "archive preserves existing signed endpoint and epoch milliseconds input");
  const verified = await client.callTool({ name: "verify_print", arguments: signedRow });
  const verifiedOutput = verified.structuredContent as Record<string, unknown>;
  ok(verifiedOutput.valid === true && verifiedOutput.metadataSigned === false
    && verifiedOutput.verifiedWithKid === "old", "MCP verification returns exact-key result and explicit unsigned metadata boundary");
  const beforeInvalid = calls.length;
  for (const [name, args] of [
    ["get_index_batch", { symbols: [] }],
    ["get_index_batch", { symbols: Array(101).fill("BTC") }],
    ["get_index_batch", { symbols: ["BTC\nETH"] }],
    ["list_index_assets", { limit: 101 }],
    ["list_index_assets", { limit: 0 }],
    ["list_index_assets", { offset: -1 }],
    ["list_index_assets", { offset: 0.5 }],
    ["list_index_assets", { offset: 100001 }],
    ["list_index_assets", { status: "arbitrary" }],
    ["get_settlement_print", { symbol: "BTC", at: "not-a-date" }],
    ["get_index_price", { symbol: "../pubkey" }],
    ["verify_print", { ...exactReceipt, grade: "composite\nextra" }],
    ["verify_print", { ...exactReceipt, price: 1.24 }]
  ] as Array<[string, Record<string, unknown>]>) {
    const invalid = await client.callTool({ name, arguments: args });
    ok(invalid.isError === true, "MCP rejects invalid input for " + name);
  }
  ok(calls.length === beforeInvalid, "invalid MCP inputs never reach the API");
} finally {
  await client.close();
  await server.close();
}

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const metadata = JSON.parse(fs.readFileSync(new URL("../server.json", import.meta.url), "utf8"));
ok([pkg.version, lock.version, lock.packages[""].version, metadata.version, metadata.packages[0].version]
  .every((version) => version === SERVER_VERSION), "runtime, package, lock and MCP Registry metadata versions stay synchronized");
console.log("✓ Pulse Verity Index selftest: " + passed + " assertions passed");
