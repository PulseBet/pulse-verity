#!/usr/bin/env node
/**
 * MCP server for the Pulse Verity Index (thepulse.markets/developers).
 *
 * Three READ-ONLY tools against the live Index API:
 *   - get_index_price(symbol)          — the signed, blended index price now
 *   - get_settlement_print(symbol, at) — the signed print nearest a moment
 *   - verify_print(print)              — LOCAL cryptographic verification
 *
 * verify_print never asks the API whether a print is genuine — it fetches
 * the public key once and checks the ECDSA signature on this machine. An
 * agent can therefore prove a price claim without trusting the transport
 * it arrived over.
 *
 * Auth: a normal Pulse developer API key (free at
 * thepulse.markets/developers) via the PULSE_API_KEY environment variable.
 * There are no write tools. Nothing here places, creates, or cancels
 * anything.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

// The public package is intentionally pinned to the public Pulse Verity Index
// API. Allowing a configurable origin would let a hostile configuration send
// the developer's API key to an unrelated server.
const API_BASE = "https://pulseclone-production.up.railway.app";
const API_KEY = process.env.PULSE_API_KEY || "";

// ── The verification recipe, self-contained ────────────────────────────────
// Mirrors the published canonical exactly (see GET /api/index/v1/pubkey):
//   pulse-index-v1 \n SYMBOL \n <price as the exact wire string> \n <at ISO> \n <grade>
// signed ECDSA P-256 / SHA-256, signature base64 in IEEE-P1363 (r||s) form.
export const INDEX_SIG_VERSION = "pulse-index-v1";

export interface VerifiablePrint {
  symbol: string;
  price: string | number;
  at: string;
  grade: string;
  signature: string;
}

export function canonicalPricePayload(p: Omit<VerifiablePrint, "signature">): string {
  return [INDEX_SIG_VERSION, p.symbol, String(p.price), p.at, p.grade].join("\n");
}

export function verifySignature(p: VerifiablePrint, publicKeyPem: string): boolean {
  try {
    const sig = Buffer.from(p.signature, "base64");
    if (sig.length !== 64) return false; // P-1363 r||s for P-256 is exactly 64 bytes
    return crypto.verify(
      "sha256",
      Buffer.from(canonicalPricePayload(p)),
      { key: publicKeyPem, dsaEncoding: "ieee-p1363" },
      sig
    );
  } catch {
    return false;
  }
}

// ── Shared API plumbing ────────────────────────────────────────────────────
interface ApiError { status: number; body: { code?: string; message?: string } }

async function apiGet<T>(path: string, params: Record<string, string>, keyed: boolean): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: {
      Accept: "application/json",
      ...(keyed ? { Authorization: `Bearer ${API_KEY}` } : {})
    },
    signal: AbortSignal.timeout(15_000)
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw { status: res.status, body } as ApiError;
  return body as T;
}

function describeApiError(error: unknown): string {
  const e = error as Partial<ApiError> & { message?: string };
  if (typeof e?.status === "number") {
    const msg = e.body?.message || e.body?.code || `HTTP ${e.status}`;
    switch (e.status) {
      case 401: return `Error: the API key was refused (${msg}). Set PULSE_API_KEY to a valid key from thepulse.markets/developers.`;
      case 404: return `Error: ${msg}`;
      case 429: return `Error: rate limited (${msg}). Free keys allow 1 request/second — wait a moment and retry, or upgrade the key's tier.`;
      case 503: return `Error: ${msg} The index only serves values it can currently stand behind; retry shortly.`;
      default: return `Error: request failed — ${msg}.`;
    }
  }
  return `Error: could not reach the Pulse Verity Index API at ${API_BASE} (${e?.message || String(error)}).`;
}

let cachedPubkeyPem: string | null = null;
async function pubkeyPem(): Promise<string> {
  if (cachedPubkeyPem) return cachedPubkeyPem;
  const r = await apiGet<{ publicKeyPem: string }>("/api/index/v1/pubkey", {}, false);
  cachedPubkeyPem = r.publicKeyPem;
  return cachedPubkeyPem;
}

const asResult = (output: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
  structuredContent: output
});
const asError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

// ── The server ─────────────────────────────────────────────────────────────
const server = new McpServer({ name: "pulse-verity", version: "1.0.0" });

const SymbolSchema = z.string()
  .min(2).max(15)
  .regex(/^[A-Za-z0-9]+$/, "Symbols are plain tickers like BTC, ETH, PEPE")
  .describe("Crypto ticker symbol, e.g. BTC, ETH, SOL, PEPE");

server.registerTool(
  "get_index_price",
  {
    title: "Get Pulse Verity Index Price",
    description: `Get the current Pulse Verity Index value for a crypto symbol, cryptographically signed.

The index is a blended value computed across multiple venues; only the blend is ever published. Every response is signed at read time, so it can be re-verified later with verify_print.

Args:
  - symbol (string): crypto ticker, e.g. "BTC". GET /api/index/v1/symbols lists the full universe (~1,700 symbols).

Returns JSON:
  {
    "symbol": "BTC",
    "price": 65123.45,        // the signed value — its exact wire string is what the signature covers
    "at": "2026-08-27T10:00:00.000Z",  // the moment the claim is about
    "grade": "composite",     // quality: composite (3+ venues) | blended (2) | single-source (1)
    "signature": "…base64…",  // ECDSA P-256 signature — feed the whole object to verify_print
    "sig": "pulse-index-v1"
  }

Errors: 404 UNSUPPORTED_SYMBOL for symbols outside the universe (equities like AAPL are never served); 503 STALE when no fresh value exists right now — the index refuses to serve a number it cannot stand behind, so treat STALE as "no answer", never as zero.`,
    inputSchema: { symbol: SymbolSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  async ({ symbol }) => {
    try {
      return asResult(await apiGet("/api/index/v1/price", { symbol }, true));
    } catch (e) {
      return asError(describeApiError(e));
    }
  }
);

server.registerTool(
  "get_settlement_print",
  {
    title: "Get Settlement Print",
    description: `Get the recorded, signed index print nearest a given moment — "what did the index say at time T".

Prints are sampled every few seconds for actively served symbols and signed at record time, so the answer is byte-identical to what the live endpoint would have returned at that moment.

Args:
  - symbol (string): crypto ticker, e.g. "BTC".
  - at (string): the moment to look up — ISO-8601 ("2026-08-27T10:00:00Z") or epoch milliseconds ("1787911200000").

Returns JSON: the same shape as get_index_price plus:
  {
    "deltaMs": 2140   // honest distance between the requested time and the nearest print
  }
Always check deltaMs — a print minutes away from the requested time answers a different question than one 2 seconds away.

Errors: 404 NO_PRINT when nothing is recorded near that time (a symbol starts recording once the API serves it; retention is bounded).`,
    inputSchema: {
      symbol: SymbolSchema,
      at: z.string().min(4).max(40).describe("ISO-8601 timestamp or epoch milliseconds")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  async ({ symbol, at }) => {
    try {
      return asResult(await apiGet("/api/index/v1/print", { symbol, at }, true));
    } catch (e) {
      return asError(describeApiError(e));
    }
  }
);

server.registerTool(
  "verify_print",
  {
    title: "Verify a Signed Print",
    description: `Cryptographically verify a Pulse index print LOCALLY — no API round-trip decides the outcome.

Rebuilds the canonical payload ("pulse-index-v1\\n<symbol>\\n<price>\\n<at>\\n<grade>") and checks the ECDSA P-256/SHA-256 signature against Pulse's published public key (fetched once from /api/index/v1/pubkey and cached). A print that verifies is proven to be exactly what Pulse signed; changing any field by even one character makes verification fail.

Args (all from a get_index_price / get_settlement_print response, unchanged):
  - symbol (string), price (string or number — the exact value as received), at (string), grade (string), signature (string, base64)

Returns JSON:
  { "valid": true | false, "checked": "<the canonical payload that was verified>", "keySource": "<pubkey endpoint>" }

A false result means the print was altered, mixed up between two reads, or not signed by Pulse's current key. Note: if Pulse's status endpoint reports keyMode "ephemeral", prints from before the API's last restart will not verify — that is a key-rotation fact, not tampering.`,
    inputSchema: {
      symbol: z.string().min(1).max(20).describe("Symbol field of the print, verbatim"),
      price: z.union([z.string(), z.number()]).describe("Price field of the print, verbatim — do not reformat or round"),
      at: z.string().min(4).max(40).describe("Timestamp field of the print, verbatim"),
      grade: z.string().min(1).max(20).describe("Grade field of the print, verbatim"),
      signature: z.string().min(10).max(200).describe("Signature field of the print, base64")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (print) => {
    try {
      const pem = await pubkeyPem();
      const valid = verifySignature(print as VerifiablePrint, pem);
      return asResult({
        valid,
        checked: canonicalPricePayload(print as VerifiablePrint),
        keySource: `${API_BASE}/api/index/v1/pubkey`
      });
    } catch (e) {
      return asError(describeApiError(e));
    }
  }
);

// ── Entry ──────────────────────────────────────────────────────────────────
// Only start the transport when run directly — the selftest imports this
// module for its exported verification functions and must not boot a server.
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (!API_KEY) {
    console.error("ERROR: PULSE_API_KEY is required. Create a free key at https://thepulse.markets/developers");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  server.connect(transport).then(
    () => console.error(`Pulse Verity Index MCP server running (API: ${API_BASE})`),
    (error: unknown) => { console.error("Server error:", error); process.exit(1); }
  );
}
