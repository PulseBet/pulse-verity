#!/usr/bin/env node
/** MCP access to signed Pulse Verity Index data and private feedback intake. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readQuotaDetails, quotaErrorGuidance, readKeyRequiredDetails, safeDailyReset, readBoundedErrorObject,
  readBatchRefusal, batchRefusalGuidance, parseUsageHeader, usageWarning, usageNoteForUser, safeIsoTimestamp,
  USAGE_HEADER, DEVELOPER_UPGRADE_URL, DEVELOPER_ACCOUNT_URL } from "./quotaError.js";
import type { QuotaDetails, KeyRequiredDetails, BatchRefusalDetails, UsageHint } from "./quotaError.js";
import { toolOutputShape, validateToolSuccess, errorSchema, requestIdSchema, accountStatusSchema, historySchema, historyWireSchema,
  assetIdSchema, HISTORY_MAX_ROWS, HISTORY_SIGNED_HOURLY_MAX_ROWS, HISTORY_DATASET_LABELS, HISTORY_SOURCE_CLASSES, METHODOLOGY_VERSION } from "./mcpContracts.js";
import type { ReadToolName } from "./mcpContracts.js";
import { feedbackInputSchema, feedbackReceiptSchema, feedbackFailureCodes, containsFeedbackSecret, containsFeedbackTranscript, FEEDBACK_MAX_BYTES } from "./feedbackContract.js";
import type { FeedbackInput } from "./feedbackContract.js";

export const SERVER_VERSION = "1.3.4";
export const USER_AGENT = "pulse-verity/" + SERVER_VERSION;
export const API_BASE = "https://mcp.thepulse.markets";
/** Built into the package; never taken from an API response. */
export const DEVELOPER_SIGNUP_URL = "https://thepulse.markets/developers?ref=mcp-npm#/signup";
export const HOSTED_MCP_URL = "https://mcp.thepulse.markets/api/index/mcp";
export const INDEX_SIG_VERSION = "pulse-index-v1";
export const INDEX_SIG_VERSION_V2 = "pulse-index-v2";
/** Complete live index-print contract. Recorded prints have no live age fields. */
export const INDEX_PRINT_V2_FIELDS = [
  "symbol", "price", "priceText", "at", "grade",
  "engine", "sources", "tier", "confidence", "dispersionBps",
  "interval.lower", "interval.upper",
  "cadence.band", "cadence.calculatedAgeMs", "cadence.newestSourceAgeMs", "cadence.oldestSourceAgeMs",
  "cadence.p50UpdateMs", "cadence.p95UpdateMs"
] as const;
export const ARCHIVE_PRINT_V2_FIELDS = [
  "symbol", "price", "priceText", "at", "grade",
  "engine", "sources", "tier", "confidence", "dispersionBps",
  "interval.lower", "interval.upper", "cadence.band"
] as const;
export const DAILY_CLOSE_V2_FIELDS = [...ARCHIVE_PRINT_V2_FIELDS, "assetId", "closeDay"] as const;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const REQUEST_TIMEOUT_MS = 15_000;
export const KEY_CACHE_TTL_MS = 300_000;
export const KEY_REFRESH_COOLDOWN_MS = 30_000;
export const MAX_VERIFICATION_KEYS = 16;

const API_PATHS = [
  "/api/index/v1/price", "/api/index/v1/batch", "/api/index/v1/print",
  "/api/index/v1/verity/catalog", "/api/index/v1/pubkey",
  // The keyless taste. Reached only when PULSE_API_KEY is absent; see the
  // routing in createApiClient and the boot note at the bottom of this file.
  "/api/index/v1/sample", "/api/index/v1/feedback",
  // 1.3.4: the account's plan and usage (keyed, never metered) and index history.
  "/api/index/v1/account", "/api/index/v1/history"
] as const;

/** Assets the keyless sample covers. Everything else needs a developer key. */
export const SAMPLE_SYMBOLS = ["BTC", "ETH", "SOL"];

/** Thrown when an unkeyed caller asks for something the sample cannot serve.
 *  Its message is passed through to the tool result verbatim — that is the
 *  whole point: the invitation has to appear where the developer is looking. */
export class NeedsKey extends Error {}

/** Thrown when the keyless sample answers 401 KEY_REQUIRED: this network's
 *  daily samples are spent. Only validated fields survive from the response. */
export class KeyRequired extends Error {
  readonly details: KeyRequiredDetails;
  constructor(details: KeyRequiredDetails) {
    super("KEY_REQUIRED");
    const resetAt = safeDailyReset(details.resetAt);
    const limit = Number.isInteger(details.limit) && details.limit! >= 1 && details.limit! <= 1000 ? details.limit : undefined;
    this.details = { code: "KEY_REQUIRED", ...(resetAt ? { resetAt } : {}), ...(limit ? { limit } : {}) };
  }
}

const SAMPLE_LIST = SAMPLE_SYMBOLS.slice(0, -1).join(", ") + " and " + SAMPLE_SYMBOLS[SAMPLE_SYMBOLS.length - 1];
// URLs are followed by a space, never by punctuation a reader could copy into the link.
const ACCOUNT_TEXT =
  "Sign up at " + DEVELOPER_SIGNUP_URL + " (Developer plan, no charge; Continue with Google skips the email step). " +
  "The key goes in PULSE_API_KEY in the MCP client's private configuration, followed by a restart; it never belongs in chat. " +
  "Alternatively, connect the hosted server at " + HOSTED_MCP_URL + " and sign in, with no key to copy.";

export const NEEDS_KEY_TEXT =
  "Note for the user: this request needs a Pulse Verity developer key. " +
  "Without one, this server answers get_index_price with limited keyless samples for " + SAMPLE_LIST + ". " +
  "A Pulse Verity developer account gives access to every supported asset, batch reads and recorded prints, " +
  "within the account's allowance. " + ACCOUNT_TEXT;

export function keyRequiredText(details: KeyRequiredDetails = { code: "KEY_REQUIRED" }): string {
  const { resetAt, limit } = new KeyRequired(details).details;
  return "Note for the user: the keyless Pulse Verity samples for this network are used up for today" +
    (limit ? " (" + limit + " per UTC day)" : "") + "; " +
    (resetAt ? "they reset at " + resetAt + " (UTC). " : "they reset with the next UTC day. ") +
    "A Pulse Verity developer account continues from here, with every supported asset, batch reads and recorded prints, " +
    "within the account's allowance. " + ACCOUNT_TEXT +
    " Repeating the request before the reset returns this same answer.";
}

/** The package's own wording for every keyless sample. The server's note and
 *  link are replaced, never forwarded: only fields this package can vouch for
 *  reach the agent, and the link carries this package's attribution. */
export const KEYLESS_SAMPLE_NOTE =
  "Note for the user: this is a keyless Pulse Verity sample (" + SAMPLE_LIST + " only, a small number per network each UTC day). " +
  "A Pulse Verity developer account gives access to every supported asset, batch reads and recorded prints, " +
  "within the account's allowance. " + ACCOUNT_TEXT +
  " Anyone can check a signature with the public key, no account needed: https://thepulse.markets/.well-known/pulse-verity-keys.json";

const KEYLESS_INSTRUCTIONS =
  "Pulse Verity is running without a developer key. Note for the user: get_index_price answers limited keyless samples for " +
  SAMPLE_LIST + ", a small number per network each UTC day, and verify_print works without a key. " +
  "Other assets, batch reads, recorded prints, history, account status and feedback need a Pulse Verity developer account. " + ACCOUNT_TEXT;
type ApiPath = typeof API_PATHS[number];
export type ApiClient = (path: ApiPath, params?: Record<string, string>, feedback?: FeedbackInput) => Promise<Record<string, unknown>>;

const SafeText = (max: number) => z.string().min(1).max(max)
  .regex(/^[^\x00-\x1f\x7f\u0085\u2028\u2029]+$/, "Control characters are not allowed");
const SymbolSchema = z.string().min(1).max(20).regex(/^[A-Za-z0-9]+$/)
  .describe("Crypto ticker symbol, e.g. BTC, ETH, SOL");
const KidSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
const PriceTextSchema = z.string().min(1).max(100)
  .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)), "Price must be finite");
const TimestampSchema = SafeText(40).refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
/** An ISO-8601 calendar time with an explicit zone, e.g. 2026-10-01T00:00:00Z. */
const IsoTimeSchema = z.string().max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/, "Expected an ISO-8601 time with a zone, e.g. 2026-10-01T00:00:00Z")
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid time");
const PrintFields = {
  symbol: SymbolSchema,
  price: z.union([PriceTextSchema, z.number().finite()]),
  priceText: PriceTextSchema.optional().describe("Exact signed price text, when provided by the API; preserve unchanged"),
  at: TimestampSchema.describe("Timestamp from the print, unchanged"),
  grade: SafeText(20),
  signature: z.string().length(88).regex(/^[A-Za-z0-9+/]{86}==$/).describe("ECDSA P-256 signature in base64"),
  kid: KidSchema.nullable().optional().describe("Signing key identifier, when provided by the API; null counts as absent"),
  sig: z.literal(INDEX_SIG_VERSION).optional(),
  kind: z.literal("daily-close").optional().describe("Selects the daily-close record format; this selector is not itself signed"),
  assetId: SafeText(160).nullable().optional(),
  closeDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  engine: SafeText(64).nullable().optional(),
  sources: z.number().int().nonnegative().nullable().optional(),
  tier: SafeText(20).nullable().optional(),
  confidence: z.number().finite().nullable().optional(),
  dispersionBps: z.number().finite().nullable().optional(),
  interval: z.object({ lower: z.number().finite().nullable(), upper: z.number().finite().nullable() }).nullable().optional(),
  cadence: z.object({
    band: SafeText(40).nullable().optional(),
    calculatedAgeMs: z.number().finite().nullable().optional(),
    newestSourceAgeMs: z.number().finite().nullable().optional(),
    oldestSourceAgeMs: z.number().finite().nullable().optional(),
    p50UpdateMs: z.number().finite().nullable().optional(),
    p95UpdateMs: z.number().finite().nullable().optional()
  }).nullable().optional(),
  v2: z.object({
    sig: z.literal(INDEX_SIG_VERSION_V2),
    canonical: z.string().min(1).max(8192).describe("The exact signed string from the print, unchanged"),
    signature: z.string().length(88).regex(/^[A-Za-z0-9+/]{86}==$/),
    kid: KidSchema
  }).optional().describe("The unchanged v2 block, which signs price and quality fields together")
};
const UnsignedPrintSchema = z.object(PrintFields).omit({ signature: true });
const PrintSchema = z.object(PrintFields);

export type VerifiablePrint = z.infer<typeof PrintSchema>;

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

export interface PrintV2Verification {
  valid: boolean;
  signatureValid: boolean;
  fieldsMatch: boolean;
  mismatches: string[];
  signedFields: Record<string, unknown> | null;
}

function readRecordPath(record: unknown, path: string): unknown {
  let value: unknown = record;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = Object.prototype.hasOwnProperty.call(value, part) ? (value as Record<string, unknown>)[part] : undefined;
  }
  return value;
}

/** Verify exact bytes and every field in one complete index record format.
 * Exact field orders reject partial/other-family records even if signed.
 * Archived signatures cover the cadence band, never live freshness ages. */
export function verifyRecordV2(input: unknown, publicKeyPem: string): PrintV2Verification {
  const fail = (signatureValid = false): PrintV2Verification => ({
    valid: false, signatureValid, fieldsMatch: false, mismatches: [], signedFields: null
  });
  try {
    const print = PrintSchema.parse(input);
    const v2 = print.v2;
    if (!v2 || Buffer.byteLength(v2.canonical, "utf8") > 8192) return fail();
    const signature = Buffer.from(v2.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== v2.signature) return fail();
    const signatureValid = crypto.verify("sha256", Buffer.from(v2.canonical, "utf8"),
      { key: publicP256Key(publicKeyPem), dsaEncoding: "ieee-p1363" }, signature);
    const lines = v2.canonical.split("\n");
    const fields = print.kind === "daily-close" ? DAILY_CLOSE_V2_FIELDS
      : lines.length === INDEX_PRINT_V2_FIELDS.length + 1 ? INDEX_PRINT_V2_FIELDS : ARCHIVE_PRINT_V2_FIELDS;
    if (lines[0] !== INDEX_SIG_VERSION_V2 || lines.length !== fields.length + 1) return fail(signatureValid);
    if (fields !== INDEX_PRINT_V2_FIELDS && print.cadence
      && Object.entries(print.cadence).some(([name, value]) => name !== "band" && value != null)) return fail(signatureValid);
    const signedFields: Record<string, unknown> = {};
    const mismatches: string[] = [];
    for (const [index, path] of fields.entries()) {
      const prefix = path + "=";
      if (!lines[index + 1].startsWith(prefix)) return fail(signatureValid);
      let value: unknown;
      try { value = JSON.parse(lines[index + 1].slice(prefix.length)); }
      catch { return fail(signatureValid); }
      if (value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) return fail(signatureValid);
      signedFields[path] = value;
      if ((readRecordPath(print, path) ?? null) !== value) mismatches.push(path);
    }
    const fieldsMatch = mismatches.length === 0;
    return { valid: signatureValid && fieldsMatch, signatureValid, fieldsMatch, mismatches, signedFields };
  } catch {
    return fail();
  }
}

/** The response body passed MAX_RESPONSE_BYTES. Repeating the same request cannot help. */
class ResponseTooLarge extends Error { constructor() { super("API response exceeded its size limit"); } }

// API origin and paths are pinned. Redirects never receive the developer key.
// Errors retain only allowlisted quota metadata, never raw upstream text or links.
export class ApiFailure extends Error {
  constructor(readonly status: number, readonly quota: QuotaDetails = {}, readonly detail: FailureDetail = {}) { super("HTTP " + status); }
}

/** What survives from a 400/403/404/409 body: a batch refusal's validated
 *  numbers, or one of the history codes below. Never text. */
export interface FailureDetail { batch?: BatchRefusalDetails; code?: HistoryErrorCode }

/** /v1/history refusals this package recognises, each with its own wording. */
const HISTORY_ERRORS = {
  BAD_QUERY: [400, "check_input", "Error: the history request was not accepted. Pass symbol, dataset (verified or reconstructed) and interval (1m, 5m, 1h or 1d)."],
  BAD_INTERVAL: [400, "check_input", "Error: reconstructed history is served at interval 1h or 1d."],
  BAD_LIMIT: [400, "check_input", "Error: limit must be a whole number from 1 to " + HISTORY_MAX_ROWS + ", and at most "
    + HISTORY_SIGNED_HOURLY_MAX_ROWS + " for dataset=verified at interval 1h or 1d, where a page can count hours and each hour can carry up to four signed prints."],
  BAD_RANGE: [400, "check_input", "Error: from and to must be valid ISO-8601 times, with from before to."],
  BAD_CURSOR_OR_IDENTITY: [400, "check_input", "Error: the cursor or assetId does not match this query. Repeat the same symbol, dataset and interval with the previous page's nextCursor, or start again without a cursor."],
  RESEARCH_NOT_INCLUDED: [403, "review_access", "Error: this account's plan does not include history. Plans and what each includes: " + DEVELOPER_UPGRADE_URL],
  UNSUPPORTED_SYMBOL: [404, "choose_another_symbol", "Error: no Pulse Verity crypto asset matches this symbol."],
  UNSUPPORTED_ASSET: [404, "choose_another_symbol", "Error: no Pulse Verity crypto asset matches this symbol or assetId."],
  ASSET_ID_REQUIRED: [409, "check_input", "Error: this symbol identifies more than one asset. Pass its canonical assetId as well."],
  VERIFIED_IDENTITY_NOT_BOUND: [409, "check_input", "Error: signed history for this ticker cannot be tied to one asset, because the ticker maps to more than one; no asset-specific signed history is available."]
} as const satisfies Record<string, readonly [number, "check_input" | "review_access" | "choose_another_symbol", string]>;
type HistoryErrorCode = keyof typeof HISTORY_ERRORS;
function historyErrorCode(value: unknown, status: number): HistoryErrorCode | undefined {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(HISTORY_ERRORS, value)
    && HISTORY_ERRORS[value as HistoryErrorCode][0] === status ? value as HistoryErrorCode : undefined;
}

/** The account endpoint answered 404: this server does not offer it yet. */
class AccountStatusUnavailable extends Error {}
export const HISTORY_TOO_LARGE_TEXT =
  "Error: this history page was larger than this package reads in one response. Repeat the request with a smaller limit; "
  + "pagination.nextCursor then continues from where the smaller page ends.";
export const ACCOUNT_STATUS_UNAVAILABLE_TEXT =
  "Error: account status is not available from this Pulse Verity server yet. The account's plan, usage and limits are shown at " + DEVELOPER_ACCOUNT_URL;
/** A history request this package refuses before any network call. */
class HistoryInputError extends Error {
  constructor(readonly code: "BAD_INTERVAL" | "BAD_RANGE" | "BAD_LIMIT") { super(code); }
}

/** Usage hints ride beside a response body, never inside it: structured
 *  output keeps exactly the fields its schema names. */
const usageHints = new WeakMap<object, UsageHint>();
type FeedbackFailureCode = typeof feedbackFailureCodes[number];
class FeedbackFailure extends Error {
  constructor(readonly code: FeedbackFailureCode, readonly retryAfterSeconds?: number) { super(code); }
}

async function feedbackFailure(response: Response): Promise<FeedbackFailure> {
  let code: FeedbackFailureCode = "FEEDBACK_UNAVAILABLE";
  const header = response.headers.get("retry-after") ?? "";
  const retryAfterSeconds = /^\d{1,5}$/.test(header) && Number(header) >= 1 && Number(header) <= 86400 ? Number(header) : undefined;
  const reader = response.body?.getReader();
  try {
    if (Number(response.headers.get("content-length")) > FEEDBACK_MAX_BYTES) throw new Error("Oversize");
    if (reader) {
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > FEEDBACK_MAX_BYTES) throw new Error("Oversize");
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (feedbackFailureCodes.includes(body?.code)) code = body.code;
    }
  } catch { await reader?.cancel().catch(() => {}); }
  finally { reader?.releaseLock(); }
  return new FeedbackFailure(code, code === "FEEDBACK_RATE_LIMITED" ? retryAfterSeconds : undefined);
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

export function describeApiError(error: unknown, tool?: string): string {
  if (error instanceof AccountStatusUnavailable) return ACCOUNT_STATUS_UNAVAILABLE_TEXT;
  if (error instanceof HistoryInputError) return HISTORY_ERRORS[error.code][2];
  if (error instanceof ResponseTooLarge && tool === "get_index_history") return HISTORY_TOO_LARGE_TEXT;
  if (error instanceof ApiFailure && error.detail.batch) return batchRefusalGuidance(error.detail.batch).text;
  if (error instanceof ApiFailure && error.detail.code) return HISTORY_ERRORS[error.detail.code][2];
  if (error instanceof ApiFailure && error.status === 404 && tool === "get_index_history") return "Error: history for this symbol is unavailable.";
  if (error instanceof InvalidResponse) return "Error: the API response did not match the expected format. Report this call's requestId; no usable price or saved feedback receipt was confirmed.";
  if (error instanceof FeedbackFailure) {
    const messages: Record<FeedbackFailureCode, string> = {
      FEEDBACK_DISABLED: "Feedback intake is not enabled. No report was saved.",
      FEEDBACK_INVALID: "Check the feedback fields and reproduction steps. No report was saved.",
      FEEDBACK_SENSITIVE: "Remove credentials or sensitive data from the report before submitting it.",
      FEEDBACK_RATE_LIMITED: "Feedback submissions are temporarily rate limited. Wait before trying again.",
      FEEDBACK_CAPACITY: "Feedback intake has reached its storage limit. No report was saved.",
      FEEDBACK_UNAVAILABLE: "Feedback intake is unavailable. Submission could not be confirmed.",
      FEEDBACK_NOT_FOUND: "The feedback report was not found.",
      NO_KEY: "Feedback requires a developer API key. Configure PULSE_API_KEY privately.",
      BAD_KEY: "The developer API key was refused. Configure a valid key privately."
    };
    return "Error: " + messages[error.code];
  }
  if (error instanceof ApiFailure) {
    switch (error.status) {
      case 401: return "Error: the API key was refused. Set PULSE_API_KEY to a valid key from thepulse.markets/developers.";
      case 403: return "Error: this API key does not have access to the requested data.";
      case 404: return "Error: the symbol or recorded print is unavailable.";
      case 429: return quotaErrorGuidance(error.quota).text;
      case 503: return "Error: the requested index data is currently unavailable. Retry shortly; unavailable prices are not zero.";
      default: return "Error: the Pulse Verity Index API returned HTTP " + error.status + ".";
    }
  }
  // A missing key is not a failure to hide behind a generic sentence — it is
  // the one message that has to reach the person, so it passes through whole.
  if (error instanceof NeedsKey) return error.message;
  if (error instanceof KeyRequired) return keyRequiredText(error.details);
  return "Error: the Pulse Verity Index request or verification could not complete. Check the inputs and connection, then retry shortly.";
}

/** True when PULSE_API_KEY holds something that could actually be a key.
 *
 * Absent and malformed both mean "serve the sample". The subtle case is a
 * one-click installer whose template never expanded: Claude Desktop's manifest
 * sets PULSE_API_KEY to "${user_config.pulse_api_key}", and if the user leaves
 * the field blank some hosts pass that literal through. It contains no
 * whitespace, so a naive check calls it a key, sends it, and the person gets
 * "the API key was refused" instead of the working sample — the 1.1.0 failure
 * wearing a different hat. An unexpanded template and the documented
 * copy-paste placeholders are treated as no key at all.
 */
export function hasUsableKey(apiKey: string): boolean {
  if (!apiKey) return false;
  if (/[\s\x00-\x1f\x7f]/.test(apiKey)) return false;
  if (apiKey.includes("${")) return false;
  return !PLACEHOLDER_KEYS.has(apiKey.toLowerCase());
}

const PLACEHOLDER_KEYS = new Set([
  "pidx_your_key_here", "your_key_here", "your_api_key", "your-api-key",
  "pidx_", "changeme", "xxx", "none", "null", "undefined"
]);

/** Whether a client built by createApiClient holds a usable key; read by createIndexServer. */
const clientKeyState = new WeakMap<ApiClient, boolean>();

export function createApiClient(apiKey: string, fetcher: typeof fetch = fetch): ApiClient {
  const hasKey = hasUsableKey(apiKey);
  const client: ApiClient = async (path, params = {}, feedback) => {
    if (!API_PATHS.includes(path)) throw new Error("Unsupported API path");
    const isFeedback = path === "/api/index/v1/feedback";
    if (feedback !== undefined && !isFeedback) throw new Error("Unexpected write payload");
    if (isFeedback) {
      const parsed = feedbackInputSchema.safeParse(feedback);
      if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > FEEDBACK_MAX_BYTES) throw new FeedbackFailure("FEEDBACK_INVALID");
      feedback = parsed.data;
      if (containsFeedbackTranscript(feedback)) throw new FeedbackFailure("FEEDBACK_INVALID");
      if (containsFeedbackSecret(feedback)) throw new FeedbackFailure("FEEDBACK_SENSITIVE");
    }
    // Without a key: a current price for a major becomes the public sample,
    // and everything else says so in words the caller will actually read.
    if (!hasKey && path !== "/api/index/v1/pubkey") {
      const symbol = String(params.symbol || "").toUpperCase();
      if (path === "/api/index/v1/price" && SAMPLE_SYMBOLS.includes(symbol)) {
        path = "/api/index/v1/sample" as ApiPath;
        params = { symbol };
      } else {
        throw new NeedsKey(NEEDS_KEY_TEXT);
      }
    }
    const keyed = hasKey && path !== "/api/index/v1/pubkey" && path !== "/api/index/v1/sample";
    const query = new URLSearchParams(params).toString();
    const response = await fetcher(API_BASE + path + (query ? "?" + query : ""), {
      method: isFeedback ? "POST" : "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(keyed ? { Authorization: "Bearer " + apiKey } : {}), ...(isFeedback ? { "Content-Type": "application/json" } : {}) },
      ...(isFeedback ? { body: JSON.stringify(feedback) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      if (isFeedback) throw await feedbackFailure(response);
      if (response.status === 429) throw new ApiFailure(response.status, await readQuotaDetails(response));
      // No key was configured, so "the API key was refused" would be false.
      // KEY_REQUIRED means the keyless daily samples are spent; the text and
      // link are rebuilt here, never forwarded. A configured key's 401 below
      // keeps its existing meaning.
      if (response.status === 401 && !hasKey) {
        const details = await readKeyRequiredDetails(response);
        throw details ? new KeyRequired(details) : new NeedsKey(NEEDS_KEY_TEXT);
      }
      // A batch refusal names the plan's limit; a history refusal names why.
      // Only validated numbers and allowlisted codes survive the bounded read.
      const isBatch = path === "/api/index/v1/batch" && response.status === 400;
      const isHistory = path === "/api/index/v1/history" && [400, 403, 404, 409].includes(response.status);
      if (isBatch || isHistory) {
        const body = await readBoundedErrorObject(response);
        const batch = isBatch ? readBatchRefusal(body) : undefined;
        const code = isHistory ? historyErrorCode(body?.code, response.status) : undefined;
        throw new ApiFailure(response.status, {}, { ...(batch ? { batch } : {}), ...(code ? { code } : {}) });
      }
      await response.body?.cancel();
      throw new ApiFailure(response.status);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new ResponseTooLarge();
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
        if (length > MAX_RESPONSE_BYTES) throw new ResponseTooLarge();
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
    if (path === "/api/index/v1/sample") {
      const sample = body as Record<string, unknown>;
      if ("note" in sample) sample.note = KEYLESS_SAMPLE_NOTE;
      if ("getKey" in sample) sample.getKey = DEVELOPER_SIGNUP_URL;
    }
    // Past 80% and 95% of the month, a keyed response says so in a header.
    // Parsed strictly; the note the person reads is built by this package.
    if (keyed) {
      const hint = parseUsageHeader(response.headers.get(USAGE_HEADER));
      if (hint) usageHints.set(body, hint);
    }
    return body as Record<string, unknown>;
  };
  clientKeyState.set(client, hasKey);
  return client;
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
      const candidates = print.kid != null
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

  /** Full-record signatures select only the exact key named by v2.kid. */
  async verifyV2(input: VerifiablePrint): Promise<PrintV2Verification & { verifiedWithKid: string | null }> {
    const print = PrintSchema.parse(input);
    const kid = print.v2?.kid ?? "";
    const check = (ring: KeyRing) => {
      const pem = ring.keys.get(kid);
      const result: PrintV2Verification = pem ? verifyRecordV2(print, pem)
        : { valid: false, signatureValid: false, fieldsMatch: false, mismatches: [], signedFields: null };
      return { ...result, verifiedWithKid: result.signatureValid ? kid : null };
    };
    const first = await this.load();
    const result = check(first);
    if (result.signatureValid) return result;
    const refreshed = await this.load(true);
    return refreshed === first ? result : check(refreshed);
  }
}

class InvalidResponse extends Error {}
/** The JSON text first, exactly as before; each note is a SEPARATE text block
 *  written by this package, never a field of structuredContent. */
const asOutput = (output: Record<string, unknown>, requestId: string, notes: string[] = []) => {
  const structuredContent = { ...output, requestId };
  return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) },
    ...notes.map((text) => ({ type: "text" as const, text }))], structuredContent };
};
const asResult = (tool: ReadToolName, output: Record<string, unknown>, requestId: string, notes: string[] = []) => {
  try { validateToolSuccess(tool, output); } catch { throw new InvalidResponse(); }
  return asOutput(output, requestId, notes);
};
const usageNotes = (output: unknown): string[] => {
  const hint = output && typeof output === "object" ? usageHints.get(output) : undefined;
  return hint ? [usageNoteForUser(hint)] : [];
};
const asError = (error: unknown, requestId: string, tool?: string) => {
  let detail: Record<string, unknown>;
  if (error instanceof AccountStatusUnavailable) detail = { code: "ACCOUNT_STATUS_UNAVAILABLE", nextAction: "review_access",
    retryable: false, accountUrl: DEVELOPER_ACCOUNT_URL };
  else if (error instanceof HistoryInputError) detail = { code: error.code, nextAction: "check_input", retryable: false };
  else if (error instanceof ResponseTooLarge && tool === "get_index_history") detail = { code: "RESPONSE_TOO_LARGE", nextAction: "check_input", retryable: false };
  else if (error instanceof ApiFailure && error.detail.batch) detail = { ...batchRefusalGuidance(error.detail.batch).error };
  else if (error instanceof ApiFailure && error.detail.code) {
    const [, nextAction] = HISTORY_ERRORS[error.detail.code];
    detail = { code: error.detail.code, nextAction, retryable: false,
      ...(error.detail.code === "RESEARCH_NOT_INCLUDED" ? { upgradeUrl: DEVELOPER_UPGRADE_URL } : {}) };
  } else if (error instanceof FeedbackFailure) {
    const retryable = ["FEEDBACK_RATE_LIMITED", "FEEDBACK_UNAVAILABLE"].includes(error.code);
    const nextAction = ["NO_KEY", "BAD_KEY"].includes(error.code) ? "reconnect"
      : ["FEEDBACK_INVALID", "FEEDBACK_SENSITIVE"].includes(error.code) ? "check_input" : retryable ? "wait" : "report_issue";
    detail = { code: error.code, nextAction, retryable, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
  } else if (error instanceof ApiFailure && error.status === 429) detail = { ...quotaErrorGuidance(error.quota).error };
  else if (error instanceof NeedsKey) detail = { code: "NO_KEY", nextAction: "get_key", retryable: false,
    getKeyUrl: DEVELOPER_SIGNUP_URL, hostedServerUrl: HOSTED_MCP_URL };
  else if (error instanceof KeyRequired) detail = { code: "KEY_REQUIRED", nextAction: "get_key", retryable: false,
    getKeyUrl: DEVELOPER_SIGNUP_URL, hostedServerUrl: HOSTED_MCP_URL,
    ...(error.details.resetAt ? { resetAt: error.details.resetAt } : {}) };
  else if (error instanceof InvalidResponse) detail = { code: "INVALID_RESPONSE", nextAction: "report_issue", retryable: false };
  else if (error instanceof ApiFailure) {
    const choices: Record<number, [string, string, boolean]> = {
      400: ["BAD_REQUEST", "check_input", false], 401: ["BAD_KEY", "reconnect", false],
      403: ["FORBIDDEN", "review_access", false], 404: ["NOT_FOUND", "choose_another_symbol", false],
      503: ["DATA_UNAVAILABLE", "wait", true]
    };
    const [code, nextAction, retryable] = choices[error.status] ?? ["UPSTREAM_ERROR", "report_issue", false];
    detail = { code, nextAction, retryable };
  } else detail = { code: "REQUEST_FAILED", nextAction: "wait", retryable: true };
  return { content: [{ type: "text" as const, text: describeApiError(error, tool) }], isError: true,
    structuredContent: { error: detail, requestId } };
};
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };

/** The package's own words for a history page; the server's note is never relayed. */
export const HISTORY_NOTES = {
  verified: "Built from prints Pulse calculated and signed live. verify_print checks a verifiedObservations row's price fields; candles, metrics and the surrounding metadata are unsigned summaries.",
  reconstructed: "Rebuilt under the stated methodology and not signed live at the historical time. Coverage and confidence are reported in provenance; candles and metrics are unsigned summaries.",
  reconstructedEmpty: "No rebuilt history is loaded for this asset at this interval. Signed history (dataset=verified) covers what Pulse has recorded live."
} as const;
type WireProvenance = NonNullable<z.infer<typeof historyWireSchema>["provenance"]>;
/** Known source classes and version-shaped methodology labels only; counts and spreads are numbers. */
function historyProvenance({ sourceClass, methodologyVersions, ...measured }: WireProvenance) {
  return {
    ...((HISTORY_SOURCE_CLASSES as readonly string[]).includes(sourceClass ?? "") ? { sourceClass } : {}),
    ...(methodologyVersions ? { methodologyVersions: methodologyVersions.filter((version) => METHODOLOGY_VERSION.test(version)) } : {}),
    ...measured
  };
}

export interface IndexServerOptions {
  /** Overrides key detection; otherwise read from a createApiClient client, or PULSE_API_KEY. */
  hasKey?: boolean;
}

export function createIndexServer(api?: ApiClient, options: IndexServerOptions = {}): McpServer {
  const envKey = process.env.PULSE_API_KEY || "";
  if (!api) api = createApiClient(envKey);
  const hasKey = options.hasKey ?? clientKeyState.get(api) ?? hasUsableKey(envKey);
  // Instructions only matter before a key exists: they tell the agent what the
  // keyless sample is and how the person connects. A keyed server sends none.
  const server = new McpServer({ name: "pulse-verity", version: SERVER_VERSION },
    hasKey ? {} : { instructions: KEYLESS_INSTRUCTIONS });
  const keys = new PublicKeyCache(() => api("/api/index/v1/pubkey"));
  const read = async (tool: ReadToolName, path: ApiPath, params: Record<string, string>) => {
    const requestId = crypto.randomUUID();
    try { const output = await api(path, params); return asResult(tool, output, requestId, usageNotes(output)); }
    catch (error) { return asError(error, requestId, tool); }
  };

  server.registerTool("get_index_price", {
    title: "Get Pulse Verity Index Price",
    description: "Get a current signed crypto index price from /api/index/v1/price. Returns symbol, price, optional priceText, at, grade, signature, kid and sig. Preserve priceText exactly for verify_print. Optional tier, confidence, dispersionBps, interval, sources, engine and cadence describe the observation. Pass the whole print including v2 to verify_print; require recordValid=true before trusting quality fields. Coverage changes: use list_index_assets to discover assets. A stale or unavailable response means no current price, never zero. Without a developer key, only limited daily BTC, ETH and SOL samples are served.",
    inputSchema: { symbol: SymbolSchema }, outputSchema: toolOutputShape("get_index_price"), annotations: readAnnotations
  }, ({ symbol }) => read("get_index_price", "/api/index/v1/price", { symbol }));

  server.registerTool("get_index_batch", {
    title: "Get Pulse Verity Index Batch",
    description: "Read up to 100 crypto symbols in one /api/index/v1/batch request. Returns observations with individually signed successful rows and per-symbol errors for unavailable rows. Your plan may allow fewer symbols per request: get_account_status shows batchMaxSymbols, and a larger request is refused with code TOO_MANY_SYMBOLS, batchLimit and requested, so split it. Verify each successful row with verify_print and require recordValid=true before trusting its quality fields. Surrounding batch metadata is unsigned. No automatic retries. Needs a developer key (PULSE_API_KEY) or the hosted server.",
    inputSchema: { symbols: z.array(SymbolSchema).min(1).max(100) }, outputSchema: toolOutputShape("get_index_batch"), annotations: readAnnotations
  }, ({ symbols }) => read("get_index_batch", "/api/index/v1/batch", { symbols: [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].join(",") }));

  server.registerTool("list_index_assets", {
    title: "List Pulse Verity Index Assets",
    description: "Read one bounded page from /api/index/v1/verity/catalog. Discover crypto symbols and their current coverage status and measured cadence. Catalog rows, prices and metadata are unsigned: use get_index_price or get_index_batch for signed receipts. Availability changes; total is a catalog count, not a count of fresh prices. No automatic pagination. Needs a developer key (PULSE_API_KEY) or the hosted server.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).max(100_000).default(0),
      band: z.enum(["real-time", "five-second", "ten-second", "slow", "unavailable"]).optional(),
      status: z.enum(["consensus", "blended", "indicative", "insufficient-coverage", "venue-disagreement", "unconvertible-quote", "stale", "kernel-rejected"]).optional()
    }, outputSchema: toolOutputShape("list_index_assets"), annotations: readAnnotations
  }, ({ limit, offset, band, status }) => read("list_index_assets", "/api/index/v1/verity/catalog", {
    limit: String(limit), offset: String(offset), ...(band ? { band } : {}), ...(status ? { status } : {})
  }));

  const RECORDED_PRINT_DESCRIPTION = "Get the recorded signed index print nearest a requested time from /api/index/v1/print. Accepts ISO-8601 or epoch milliseconds. Check deltaMs: it is the distance between your requested time and the sampled print. Sampling and retention are bounded; a recorded print need not equal a separate live read. Preserve the whole print, including priceText, kid and v2, for verify_print. Require recordValid=true before trusting quality fields. Request-envelope fields such as deltaMs are unsigned. Needs a developer key (PULSE_API_KEY) or the hosted server.";
  const recordedPrintInput = {
    symbol: SymbolSchema,
    at: SafeText(40).refine((value) => {
      const time = /^\d{10,}$/.test(value) ? Number(value) : Date.parse(value);
      return Number.isFinite(time) && !Number.isNaN(new Date(time).getTime());
    }, "Expected ISO-8601 or epoch milliseconds")
  };
  const recordedPrint = ({ symbol, at }: { symbol: string; at: string }) =>
    read("get_recorded_print", "/api/index/v1/print", { symbol, at });
  server.registerTool("get_recorded_print", {
    title: "Get Recorded Print",
    description: RECORDED_PRINT_DESCRIPTION,
    inputSchema: recordedPrintInput, outputSchema: toolOutputShape("get_recorded_print"), annotations: { ...readAnnotations, idempotentHint: true }
  }, recordedPrint);
  // The earlier name, kept so existing prompts and integrations keep working.
  server.registerTool("get_settlement_print", {
    title: "Get Recorded Print (earlier name)",
    description: "The earlier name of get_recorded_print, kept so existing integrations keep working; prefer get_recorded_print. Same input, output and behaviour. " + RECORDED_PRINT_DESCRIPTION,
    inputSchema: recordedPrintInput, outputSchema: toolOutputShape("get_recorded_print"), annotations: { ...readAnnotations, idempotentHint: true }
  }, recordedPrint);

  server.registerTool("get_index_history", {
    title: "Get Pulse Verity Index History",
    description: "Read one page of index history for a crypto symbol from /api/index/v1/history: candles (open, high, low, close per interval), summary metrics, pagination and, for dataset=verified, verifiedObservations. dataset=verified (default) is built from prints Pulse calculated and signed live; dataset=reconstructed is rebuilt history, not signed at the historical time, served at interval 1h or 1d. Candles, metrics and surrounding metadata are unsigned. Each verifiedObservations row carries symbol, price (the exact signed text), at, grade, signature and kid; pass those fields to verify_print to check a row, which authenticates its price fields only (history rows carry no v2 block). A null kid can be passed as it is or left out; a row whose signature or grade is null cannot be verified. The account's plan sets how far back history reaches: when the request started earlier, rangeClamped is true and from is where the page begins. limit (1 to " + HISTORY_MAX_ROWS + ", default 200) bounds the rows on one page. For dataset=verified at interval 1h or 1d it is at most " + HISTORY_SIGNED_HOURLY_MAX_ROWS + ": a page there can count hours, and each hour can carry up to four signed prints (open, high, low and close), so verifiedObservations can hold up to four rows per hour. For the next page pass pagination.nextCursor as cursor with the same symbol, dataset and interval. from and to are ISO-8601 times; the default window is the 30 days before to. Pass assetId, written as the server issues it (native:<namespace>:<id>, or contract:<network>:<address> such as contract:eip155:1:0x...), when a symbol identifies more than one asset. Needs a developer key (PULSE_API_KEY) or the hosted server.",
    inputSchema: {
      symbol: SymbolSchema,
      dataset: z.enum(["verified", "reconstructed"]).default("verified"),
      interval: z.enum(["1m", "5m", "1h", "1d"]).default("1h"),
      from: IsoTimeSchema.optional().describe("Start of the window, ISO-8601"),
      to: IsoTimeSchema.optional().describe("End of the window, ISO-8601; defaults to now"),
      limit: z.number().int().min(1).max(HISTORY_MAX_ROWS).default(200)
        .describe("Rows on one page; at most " + HISTORY_SIGNED_HOURLY_MAX_ROWS + " for dataset=verified at interval 1h or 1d"),
      cursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional().describe("pagination.nextCursor from the previous page"),
      assetId: assetIdSchema.optional()
        .describe("Canonical asset identity as the server issues it, e.g. native:pulse-verity:btc or contract:eip155:1:0x...; only when a symbol identifies more than one asset")
    }, outputSchema: { ...historySchema.partial().shape, requestId: requestIdSchema, error: errorSchema.optional() },
    annotations: { ...readAnnotations, idempotentHint: true }
  }, async ({ symbol, dataset, interval, from, to, limit, cursor, assetId }) => {
    const requestId = crypto.randomUUID();
    try {
      // Refused here, before the network, with the package's own words.
      if (dataset === "reconstructed" && (interval === "1m" || interval === "5m")) throw new HistoryInputError("BAD_INTERVAL");
      // A signed hourly page can count hours, each with up to four prints: keep it well under MAX_RESPONSE_BYTES.
      if (dataset === "verified" && (interval === "1h" || interval === "1d") && limit > HISTORY_SIGNED_HOURLY_MAX_ROWS) {
        throw new HistoryInputError("BAD_LIMIT");
      }
      const fromIso = from === undefined ? undefined : new Date(from).toISOString();
      const toIso = to === undefined ? undefined : new Date(to).toISOString();
      if (fromIso && toIso && Date.parse(fromIso) >= Date.parse(toIso)) throw new HistoryInputError("BAD_RANGE");
      const output = await api("/api/index/v1/history", {
        symbol: symbol.toUpperCase(), dataset, interval, limit: String(limit),
        ...(fromIso ? { from: fromIso } : {}), ...(toIso ? { to: toIso } : {}),
        ...(cursor ? { cursor } : {}), ...(assetId ? { assetId } : {})
      });
      const wire = historyWireSchema.safeParse(output);
      // The dataset label is written from the request, so the server must agree about how the page was signed.
      if (!wire.success || wire.data.contemporaneouslySigned !== (dataset === "verified")) throw new InvalidResponse();
      // The server's dataset label and note are replaced and its provenance labels allowlisted: no free text is relayed.
      const { dataset: _label, note: _note, provenance: wireProvenance, ...page } = wire.data;
      const parsed = historySchema.safeParse({
        ...page, dataset: HISTORY_DATASET_LABELS[dataset],
        note: dataset === "verified" ? HISTORY_NOTES.verified
          : page.pagination.coverage?.availableFrom === null ? HISTORY_NOTES.reconstructedEmpty : HISTORY_NOTES.reconstructed,
        ...(wireProvenance ? { provenance: historyProvenance(wireProvenance) } : {})
      });
      if (!parsed.success) throw new InvalidResponse();
      const notes: string[] = [];
      if (parsed.data.rangeClamped) {
        const start = safeIsoTimestamp(parsed.data.from);
        notes.push("Note for the user: the requested window started earlier than the history this request can read "
          + "(the account plan's history window, or where the signed archive begins), so this page "
          + (start ? "starts at " + start + " (UTC)." : "starts later than requested."));
      }
      return asOutput(parsed.data, requestId, [...notes, ...usageNotes(output)]);
    } catch (error) { return asError(error, requestId, "get_index_history"); }
  });

  server.registerTool("get_account_status", {
    title: "Get Pulse Verity Account Status",
    description: "Read this developer key's Pulse Verity plan and usage from /api/index/v1/account: plan, used (calls counted this UTC month), limit, remaining, resetAt, perMinute, batchMaxSymbols, capacityAction and upgradeUrl (the plans page). The monthly allowance is account-wide: every key and connected app on the account shares it; perMinute applies to each key. This call does not count toward the allowance. The key itself is never returned. Needs a developer key (PULSE_API_KEY) or the hosted server.",
    inputSchema: {},
    outputSchema: { ...accountStatusSchema.partial().shape, requestId: requestIdSchema, error: errorSchema.optional() },
    annotations: { ...readAnnotations, idempotentHint: true }
  }, async () => {
    const requestId = crypto.randomUUID();
    try {
      let output: Record<string, unknown>;
      try { output = await api("/api/index/v1/account"); }
      catch (error) { throw error instanceof ApiFailure && error.status === 404 ? new AccountStatusUnavailable() : error; }
      // Only the named fields leave this function; the plans link is the package's own.
      const parsed = accountStatusSchema.extend({ upgradeUrl: z.unknown().optional() }).safeParse(output);
      if (!parsed.success) throw new InvalidResponse();
      const status = { ...parsed.data, upgradeUrl: DEVELOPER_UPGRADE_URL };
      const usage = usageWarning(status.used, status.limit, status.resetAt);
      return asOutput(status, requestId, usage ? [usageNoteForUser(usage)] : []);
    } catch (error) { return asError(error, requestId, "get_account_status"); }
  });

  server.registerTool("verify_print", {
    title: "Verify a Signed Print",
    description: "Verify a signed print locally with ECDSA P-256/SHA-256. Legacy valid authenticates only the v1 canonical price fields. Pass the whole print including v2 to authenticate its complete live, archive or daily-close index record; agents using sources, confidence, interval or cadence must require recordValid=true. Live records sign 18 fields; archive records sign 13 without freshness ages, and daily-close records add signed assetId and closeDay. v2.signedFields lists exactly what is authenticated. kind selects the format and is not signed. Added non-null freshness ages invalidate archived verification. verificationScope is full-record only when both signatures and all required fields match, price-only for a valid v1 print without v2, or invalid otherwise. metadataSigned equals recordValid. deltaMs and surrounding metadata remain unsigned. Public keys come from /api/index/v1/pubkey, cached five minutes with refresh at most every 30 seconds. Each supplied kid selects only its exact published key; v1 prints without kid (or with kid null, as some history rows carry) use the bounded ring. No API key is sent to the key endpoint. Invalid verification can mean alteration or a key no longer published. Works without a developer key.",
    inputSchema: PrintFields, outputSchema: toolOutputShape("verify_print"),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (print) => {
    const requestId = crypto.randomUUID();
    try {
      const result = await keys.verify(print);
      const v2 = print.v2 ? await keys.verifyV2(print) : null;
      const recordValid = result.valid && v2?.valid === true;
      const verificationScope = recordValid ? "full-record" : result.valid && !print.v2 ? "price-only" : "invalid";
      return asResult("verify_print", { ...result, recordValid, verificationScope, checked: canonicalPricePayload(print),
        keySource: API_BASE + "/api/index/v1/pubkey", metadataSigned: recordValid, v2 }, requestId);
    } catch (error) { return asError(error, requestId); }
  });
  server.registerTool("submit_verity_feedback", {
    title: "Submit Verity Feedback",
    description: "Submit a reproducible Verity API or MCP bug, missing capability or data-quality report for human review. Requires a developer key (PULSE_API_KEY) or the hosted server, and an enabled feedback service. Include the failed call's requestId when available. Do not send secrets, personal information or conversation transcripts. Saves a private report; does not change prices, start trades or open or merge a PR. Returns a tracking receipt only after storage succeeds.",
    inputSchema: feedbackInputSchema,
    outputSchema: { success: z.literal(true).optional(), feedback: feedbackReceiptSchema.optional(), duplicate: z.boolean().optional(), requestId: requestIdSchema, error: errorSchema.optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input) => {
    const requestId = crypto.randomUUID();
    try {
      if (Buffer.byteLength(JSON.stringify(input), "utf8") > FEEDBACK_MAX_BYTES) throw new FeedbackFailure("FEEDBACK_INVALID");
      if (containsFeedbackTranscript(input)) throw new FeedbackFailure("FEEDBACK_INVALID");
      if (containsFeedbackSecret(input)) throw new FeedbackFailure("FEEDBACK_SENSITIVE");
      const output = await api("/api/index/v1/feedback", {}, input);
      const parsed = z.object({ success: z.literal(true), feedback: feedbackReceiptSchema, duplicate: z.boolean() }).safeParse(output);
      if (!parsed.success) throw new InvalidResponse();
      const structuredContent = { ...parsed.data, requestId };
      return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
    } catch (error) { return asError(error, requestId); }
  });
  return server;
}

// Imports for offline verification never start a transport or require a key.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (isMain) {
  // Keep the MCP transport available without a key. Keyless price requests
  // use the limited BTC, ETH and SOL sample; requests requiring developer
  // access return structured tool guidance instead of failing at startup.
  const apiKey = process.env.PULSE_API_KEY || "";
  const keyed = hasUsableKey(apiKey);
  createIndexServer().connect(new StdioServerTransport()).then(
    () => console.error(
      "Pulse Verity Index MCP server " + SERVER_VERSION + " running" +
      (keyed ? " (developer key detected)"
             : " without a developer key: limited daily " + SAMPLE_LIST + " samples. Developer account: " +
               DEVELOPER_SIGNUP_URL + " or connect the hosted server (sign in, no key to copy): " + HOSTED_MCP_URL)
    ),
    () => { console.error("Server connection failed."); process.exit(1); }
  );
}
