#!/usr/bin/env node
/** Read-only MCP access to the public Pulse Verity Index API. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const SERVER_VERSION = "1.1.0";
export const API_BASE = "https://pulseclone-production.up.railway.app";
export const INDEX_SIG_VERSION = "pulse-index-v1";
export const MAX_RESPONSE_BYTES = 1_048_576;
export const REQUEST_TIMEOUT_MS = 15_000;
export const KEY_CACHE_TTL_MS = 300_000;
export const KEY_REFRESH_COOLDOWN_MS = 30_000;
export const MAX_VERIFICATION_KEYS = 16;

const API_PATHS = [
  "/api/index/v1/price", "/api/index/v1/batch", "/api/index/v1/print",
  "/api/index/v1/verity/catalog", "/api/index/v1/pubkey"
] as const;
type ApiPath = typeof API_PATHS[number];
export type ApiClient = (path: ApiPath, params?: Record<string, string>) => Promise<Record<string, unknown>>;

const SafeText = (max: number) => z.string().min(1).max(max)
  .regex(/^[^\x00-\x1f\x7f\u0085\u2028\u2029]+$/, "Control characters are not allowed");
const SymbolSchema = z.string().min(1).max(20).regex(/^[A-Za-z0-9]+$/)
  .describe("Crypto ticker symbol, e.g. BTC, ETH, SOL");
const KidSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
const PriceTextSchema = z.string().min(1).max(100)
  .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)), "Price must be finite");
const TimestampSchema = SafeText(40).refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const PrintFields = {
  symbol: SymbolSchema,
  price: z.union([PriceTextSchema, z.number().finite()]),
  priceText: PriceTextSchema.optional().describe("Exact signed price text, when provided by the API; preserve unchanged"),
  at: TimestampSchema.describe("Timestamp from the print, unchanged"),
  grade: SafeText(20),
  signature: z.string().length(88).regex(/^[A-Za-z0-9+/]{86}==$/).describe("ECDSA P-256 signature in base64"),
  kid: KidSchema.optional().describe("Signing key identifier, when provided by the API"),
  sig: z.literal(INDEX_SIG_VERSION).optional()
};
const UnsignedPrintSchema = z.object(PrintFields).omit({ signature: true });
const PrintSchema = z.object(PrintFields);

export interface VerifiablePrint {
  symbol: string;
  price: string | number;
  priceText?: string;
  at: string;
  grade: string;
  signature: string;
  kid?: string;
  sig?: typeof INDEX_SIG_VERSION;
}

/** The immutable v1 signature covers only these five newline-separated fields. */
export function canonicalPricePayload(input: Omit<VerifiablePrint, "signature">): string {
  const p = UnsignedPrintSchema.parse(input);
  if (p.priceText !== undefined && Number(p.priceText) !== Number(p.price)) {
    throw new Error("Price and priceText disagree");
  }
  return [INDEX_SIG_VERSION, p.symbol, p.priceText ?? String(p.price), p.at, p.grade].join("\n");
}

function publicP256Key(pem: string): crypto.KeyObject {
  if (pem.length > 4096 || !pem.startsWith("-----BEGIN PUBLIC KEY-----")) {
    throw new Error("Invalid public verification key");
  }
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Verification requires a P-256 public key");
  }
  return key;
}

export function verifySignature(input: VerifiablePrint, publicKeyPem: string): boolean {
  try {
    const p = PrintSchema.parse(input);
    const signature = Buffer.from(p.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== p.signature) return false;
    return crypto.verify("sha256", Buffer.from(canonicalPricePayload(p)),
      { key: publicP256Key(publicKeyPem), dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
}

// API origin and paths are pinned. Redirects never receive the developer key.
// Errors deliberately exclude response bodies, headers and raw fetch errors.
export class ApiFailure extends Error {
  constructor(readonly status: number) { super("HTTP " + status); }
}

export function redactCredentials(value: string, apiKey = ""): string {
  return (apiKey ? value.split(apiKey).join("[REDACTED]") : value)
    .replace(/pidx_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s"\\,}]+/gi, "Bearer [REDACTED]");
}

function sanitizeResponse(value: unknown, apiKey: string, depth = 0): unknown {
  if (depth > 30) throw new Error("API response nesting exceeded its limit");
  if (typeof value === "string") return redactCredentials(value, apiKey);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite API value");
  if (Array.isArray(value)) return value.map((item) => sanitizeResponse(item, apiKey, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [redactCredentials(key, apiKey), sanitizeResponse(item, apiKey, depth + 1)]));
  return value;
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiFailure) {
    switch (error.status) {
      case 401: return "Error: the API key was refused. Set PULSE_API_KEY to a valid key from thepulse.markets/developers.";
      case 403: return "Error: this API key does not have access to the requested data.";
      case 404: return "Error: the symbol or recorded print is unavailable.";
      case 429: return "Error: the API request limit was reached. Wait before retrying; limits depend on your key's tier.";
      case 503: return "Error: the requested index data is currently unavailable. Retry shortly; unavailable prices are not zero.";
      default: return "Error: the Pulse Verity Index API returned HTTP " + error.status + ".";
    }
  }
  return "Error: the Pulse Verity Index request or verification could not complete. Check the inputs and connection, then retry shortly.";
}

export function createApiClient(apiKey: string, fetcher: typeof fetch = fetch): ApiClient {
  return async (path, params = {}) => {
    if (!API_PATHS.includes(path)) throw new Error("Unsupported API path");
    const keyed = path !== "/api/index/v1/pubkey";
    if (keyed && (!apiKey || /[\s\x00-\x1f\x7f]/.test(apiKey))) throw new Error("Invalid API key configuration");
    const query = new URLSearchParams(params).toString();
    const response = await fetcher(API_BASE + path + (query ? "?" + query : ""), {
      method: "GET",
      headers: { Accept: "application/json", ...(keyed ? { Authorization: "Bearer " + apiKey } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiFailure(response.status);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error("API response exceeded its size limit");
    }
    if (!response.body) throw new Error("Empty API response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw new Error("API response exceeded its size limit");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const body = sanitizeResponse(JSON.parse(Buffer.concat(chunks).toString("utf8")), apiKey);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid API response");
    return body as Record<string, unknown>;
  };
}

interface KeyRing { keys: Map<string, string>; }
const KeyDocumentSchema = z.object({
  activeKid: KidSchema.optional(),
  publicKeyPem: z.string().min(1).max(4096).optional(),
  verificationKeys: z.array(z.object({ kid: KidSchema, pem: z.string().min(1).max(4096) }))
    .min(1).max(MAX_VERIFICATION_KEYS).optional()
});

function parseKeyRing(input: unknown): KeyRing {
  const document = KeyDocumentSchema.parse(input);
  const keys = new Map<string, string>();
  for (const entry of document.verificationKeys ?? []) {
    publicP256Key(entry.pem);
    if (keys.has(entry.kid)) throw new Error("Duplicate verification key identifier");
    keys.set(entry.kid, entry.pem);
  }
  if (document.publicKeyPem) {
    const active = publicP256Key(document.publicKeyPem).export({ type: "spki", format: "pem" });
    if (!keys.size) keys.set(document.activeKid ?? "", document.publicKeyPem);
    else if (document.activeKid) {
      const match = keys.get(document.activeKid);
      if (!match || publicP256Key(match).export({ type: "spki", format: "pem" }) !== active) {
        throw new Error("Active verification key does not match the key ring");
      }
    }
  }
  if (!keys.size || (document.activeKid && !keys.has(document.activeKid))) {
    throw new Error("Missing public verification key");
  }
  return { keys };
}

/** Bounded cache: rotation refreshes coalesce and are limited to once per 30s. */
export class PublicKeyCache {
  private ring?: KeyRing;
  private fetchedAt = -Infinity;
  private lastAttempt = -Infinity;
  private pending?: Promise<KeyRing>;
  constructor(private readonly fetchKeys: () => Promise<unknown>, private readonly now = Date.now) {}

  private async load(force = false): Promise<KeyRing> {
    if (this.pending) return this.pending;
    const now = this.now();
    if (this.ring && !force && now - this.fetchedAt < KEY_CACHE_TTL_MS) return this.ring;
    if (now - this.lastAttempt < KEY_REFRESH_COOLDOWN_MS) {
      if (this.ring && now - this.fetchedAt < KEY_CACHE_TTL_MS) return this.ring;
      throw new Error("Verification keys temporarily unavailable");
    }
    this.lastAttempt = now;
    this.pending = (async () => {
      const ring = parseKeyRing(await this.fetchKeys());
      this.ring = ring;
      this.fetchedAt = this.now();
      return ring;
    })();
    try { return await this.pending; }
    finally { this.pending = undefined; }
  }

  async verify(input: VerifiablePrint): Promise<{ valid: boolean; verifiedWithKid: string | null }> {
    const print = PrintSchema.parse(input);
    canonicalPricePayload(print); // reject an inconsistent envelope before any request
    const match = (ring: KeyRing): { valid: boolean; verifiedWithKid: string | null } => {
      const candidates = print.kid !== undefined
        ? [...ring.keys].filter(([kid]) => kid === print.kid) : [...ring.keys];
      for (const [kid, pem] of candidates) {
        if (verifySignature(print, pem)) return { valid: true, verifiedWithKid: kid || null };
      }
      return { valid: false, verifiedWithKid: null };
    };
    const first = await this.load();
    const result = match(first);
    if (result.valid) return result;
    // One refresh at most for an unknown kid or a legacy signature after rotation.
    const refreshed = await this.load(true);
    return refreshed === first ? result : match(refreshed);
  }
}

const asResult = (output: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }], structuredContent: output
});
const asError = (error: unknown) => ({ content: [{ type: "text" as const, text: describeApiError(error) }], isError: true });
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export function createIndexServer(api: ApiClient = createApiClient(process.env.PULSE_API_KEY || "")): McpServer {
  const server = new McpServer({ name: "pulse-verity", version: SERVER_VERSION });
  const keys = new PublicKeyCache(() => api("/api/index/v1/pubkey"));
  const read = async (path: ApiPath, params: Record<string, string>) => {
    try { return asResult(await api(path, params)); }
    catch (error) { return asError(error); }
  };

  server.registerTool("get_index_price", {
    title: "Get Pulse Verity Index Price",
    description: "Get a current signed crypto index price from /api/index/v1/price. Returns symbol, price, optional priceText, at, grade, signature, kid and sig. Preserve priceText exactly for verify_print. Optional tier, confidence, dispersionBps, interval, sources, engine and cadence describe the observation but are not covered by the v1 signature. Coverage changes: use list_index_assets to discover assets. A stale or unavailable response means no current price, never zero.",
    inputSchema: { symbol: SymbolSchema }, annotations: readAnnotations
  }, ({ symbol }) => read("/api/index/v1/price", { symbol }));

  server.registerTool("get_index_batch", {
    title: "Get Pulse Verity Index Batch",
    description: "Read up to 100 crypto symbols in one /api/index/v1/batch request. Returns observations with individually signed successful rows and per-symbol errors for unavailable rows. Your API tier may allow fewer symbols. Verify each successful row with verify_print; surrounding batch and quality metadata are not signed. No automatic retries.",
    inputSchema: { symbols: z.array(SymbolSchema).min(1).max(100) }, annotations: readAnnotations
  }, ({ symbols }) => read("/api/index/v1/batch", { symbols: [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].join(",") }));

  server.registerTool("list_index_assets", {
    title: "List Pulse Verity Index Assets",
    description: "Read one bounded page from /api/index/v1/verity/catalog. Discover crypto symbols and their current coverage status and measured cadence. Catalog rows, prices and metadata are unsigned: use get_index_price or get_index_batch for signed receipts. Availability changes; total is a catalog count, not a count of fresh prices. No automatic pagination.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).max(100_000).default(0),
      band: z.enum(["real-time", "five-second", "ten-second", "slow", "unavailable"]).optional(),
      status: z.enum(["consensus", "blended", "indicative", "insufficient-coverage", "venue-disagreement", "unconvertible-quote", "stale", "kernel-rejected"]).optional()
    }, annotations: readAnnotations
  }, ({ limit, offset, band, status }) => read("/api/index/v1/verity/catalog", {
    limit: String(limit), offset: String(offset), ...(band ? { band } : {}), ...(status ? { status } : {})
  }));

  server.registerTool("get_settlement_print", {
    title: "Get Settlement Print",
    description: "Get the recorded signed index print nearest a requested time from /api/index/v1/print. Accepts ISO-8601 or epoch milliseconds. Check deltaMs: it is the distance between your requested time and the sampled print. Sampling and retention are bounded; a recorded print need not equal a separate live read. Preserve priceText and kid when present for verify_print. deltaMs and other metadata are not signed.",
    inputSchema: {
      symbol: SymbolSchema,
      at: SafeText(40).refine((value) => {
        const time = /^\d{10,}$/.test(value) ? Number(value) : Date.parse(value);
        return Number.isFinite(time) && !Number.isNaN(new Date(time).getTime());
      }, "Expected ISO-8601 or epoch milliseconds")
    }, annotations: { ...readAnnotations, idempotentHint: true }
  }, ({ symbol, at }) => read("/api/index/v1/print", { symbol, at }));

  server.registerTool("verify_print", {
    title: "Verify a Signed Print",
    description: "Verify a signed print locally with ECDSA P-256/SHA-256. Canonical bytes are pulse-index-v1\\n<symbol>\\n<priceText or String(price)>\\n<at>\\n<grade>. The public key ring is fetched from /api/index/v1/pubkey, cached for five minutes and refreshed at most once per 30 seconds on a failed check. A supplied kid selects only that exact key; old prints without kid are tried against the bounded published ring. No API key is sent to the public-key endpoint. valid=true authenticates only the canonical price fields, not kid, sig, quality, cadence, timestamps outside at, or other metadata. An invalid signature can mean an altered print or a key no longer published; it does not by itself prove tampering.",
    inputSchema: PrintFields,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (print) => {
    try {
      const result = await keys.verify(print);
      return asResult({ ...result, checked: canonicalPricePayload(print), keySource: API_BASE + "/api/index/v1/pubkey", metadataSigned: false });
    } catch (error) { return asError(error); }
  });
  return server;
}

// Imports for offline verification never start a transport or require a key.
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const apiKey = process.env.PULSE_API_KEY || "";
  if (!apiKey || /[\s\x00-\x1f\x7f]/.test(apiKey)) {
    console.error("ERROR: Set PULSE_API_KEY to a valid developer key from https://thepulse.markets/developers");
    process.exit(1);
  }
  createIndexServer().connect(new StdioServerTransport()).then(
    () => console.error("Pulse Verity Index MCP server " + SERVER_VERSION + " running"),
    () => { console.error("Server connection failed."); process.exit(1); }
  );
}
