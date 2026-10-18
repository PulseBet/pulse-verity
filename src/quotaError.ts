/** Allowlisted quota guidance shared by the public and hosted MCP adapters. */
export const MAX_QUOTA_ERROR_BYTES = 8192;
export const MAX_RETRY_AFTER_SECONDS = 86400;
export const DEVELOPER_ACCOUNT_URL = "https://thepulse.markets/developers/access";
export const DEVELOPER_UPGRADE_URL = "https://thepulse.markets/developers#/portal/pricing";
export type CapacityAction = "review_plans" | "contact_support";

export type QuotaCode = "RATE_LIMITED" | "MONTHLY_LIMIT";
export interface QuotaDetails {
  code?: QuotaCode;
  retryAfterSeconds?: number;
  resetAt?: string;
  capacityAction?: CapacityAction;
}

export interface QuotaErrorMetadata {
  code: QuotaCode | "REQUEST_LIMIT";
  nextAction: "wait" | "review_access" | "check_limits";
  retryAfterSeconds?: number;
  accountUrl?: string;
  upgradeUrl?: string;
  resetAt?: string;
  capacityAction?: CapacityAction;
}

function safeRetrySeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    && value >= 1 && value <= MAX_RETRY_AFTER_SECONDS ? value : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  return value !== null && /^[0-9]{1,5}$/.test(value)
    ? safeRetrySeconds(Number(value)) : undefined;
}

/** Only a real UTC calendar-month boundary can be presented as the reset. */
function safeMonthlyReset(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01T00:00:00\.000Z$/.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function safeCapacityAction(value: unknown): CapacityAction | undefined {
  return value === "review_plans" || value === "contact_support" ? value : undefined;
}

/** Read a JSON object error body of at most maxBytes. Anything oversized,
 * streamed past the cap, malformed or not an object becomes undefined, and
 * an unfinished stream is cancelled. Callers allowlist individual fields. */
export async function readBoundedErrorObject(response: Response,
  maxBytes = MAX_QUOTA_ERROR_BYTES): Promise<Record<string, unknown> | undefined> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel().catch(() => {});
      return undefined;
    }
    if (!response.body) return undefined;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error("Error response exceeds its size limit");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  } catch {
    await reader?.cancel().catch(() => {});
    return undefined;
  } finally {
    reader?.releaseLock();
  }
}

/** Never pass through upstream messages, links, account identifiers or headers. */
export async function readQuotaDetails(response: Response): Promise<QuotaDetails> {
  if (response.status !== 429) return {};
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  const fallback: QuotaDetails = retryAfterSeconds === undefined ? {} : { retryAfterSeconds };
  const body = await readBoundedErrorObject(response);
  if (!body) return fallback;
  const code = body.code;
  if (code === "MONTHLY_LIMIT") {
    const resetAt = safeMonthlyReset(body.resetAt);
    const capacityAction = safeCapacityAction(body.capacityAction);
    return { code, ...(resetAt ? { resetAt } : {}), ...(capacityAction ? { capacityAction } : {}) };
  }
  if (code === "RATE_LIMITED") return { code, ...fallback };
  return fallback;
}

/** The keyless sample's daily allowance is spent (HTTP 401, code KEY_REQUIRED).
 * Only the code, a canonical UTC timestamp and a small integer survive; the
 * server's message and links are discarded and rebuilt by the package. */
export interface KeyRequiredDetails {
  code: "KEY_REQUIRED";
  resetAt?: string;
  limit?: number;
}

/** A canonical ISO-8601 UTC timestamp, exactly as Date#toISOString writes it. */
export function safeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

/** A keyless daily reset is believable only if it lies within the next 48
 *  hours; anything else falls back to "the next UTC day". */
export function safeDailyReset(value: unknown, now: number = Date.now()): string | undefined {
  const iso = safeIsoTimestamp(value);
  if (!iso) return undefined;
  const at = new Date(iso).getTime();
  return at > now && at <= now + 48 * 3600 * 1000 ? iso : undefined;
}

function safeSampleLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : undefined;
}

export async function readKeyRequiredDetails(response: Response): Promise<KeyRequiredDetails | undefined> {
  if (response.status !== 401) return undefined;
  const body = await readBoundedErrorObject(response);
  if (!body || body.code !== "KEY_REQUIRED") return undefined;
  const resetAt = safeDailyReset(body.resetAt);
  const limit = safeSampleLimit(body.limit);
  return { code: "KEY_REQUIRED", ...(resetAt ? { resetAt } : {}), ...(limit ? { limit } : {}) };
}

// ── Plan hints (1.3.4) ──────────────────────────────────────────────────────
// The server tells an account two more things: a batch request named more
// symbols than its plan allows (HTTP 400, TOO_MANY_SYMBOLS or BATCH_TOO_LARGE),
// and the account has used 80% or 95% of its monthly allowance (an
// X-Verity-Usage response header). Both keep this file's rule: only an
// allowlisted code and strictly parsed numbers survive, and every sentence
// the agent reads is written here, never relayed from the server.

/** The plan names customers see. Anything else is not repeated back. */
export const PLAN_LABELS = ["Developer", "Basic", "Builder", "Commercial", "Enterprise"] as const;
export type PlanLabel = typeof PLAN_LABELS[number];
export const USAGE_HEADER = "x-verity-usage";
export const MAX_BATCH_LIMIT = 100_000;

function safeCount(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined;
}

function safePlan(value: unknown): PlanLabel | undefined {
  return typeof value === "string" && (PLAN_LABELS as readonly string[]).includes(value) ? value as PlanLabel : undefined;
}

export type BatchRefusalCode = "TOO_MANY_SYMBOLS" | "BATCH_TOO_LARGE";
export interface BatchRefusalDetails {
  code: BatchRefusalCode;
  batchLimit: number;
  requested: number;
  plan?: PlanLabel;
  capacityAction?: CapacityAction;
}

/** Reads a batch refusal body. Unknown codes, a limit outside 1..100000, a
 *  request count that does not exceed the limit, or any non-integer means
 *  "not a batch refusal", and the caller keeps its ordinary HTTP 400 answer. */
export function readBatchRefusal(body: unknown): BatchRefusalDetails | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  if (b.code !== "TOO_MANY_SYMBOLS" && b.code !== "BATCH_TOO_LARGE") return undefined;
  const batchLimit = safeCount(b.batchLimit, MAX_BATCH_LIMIT);
  const requested = safeCount(b.requested, MAX_BATCH_LIMIT);
  if (batchLimit === undefined || batchLimit < 1 || requested === undefined || requested <= batchLimit) return undefined;
  const plan = safePlan(b.plan);
  const capacityAction = safeCapacityAction(b.capacityAction);
  return { code: b.code, batchLimit, requested, ...(plan ? { plan } : {}), ...(capacityAction ? { capacityAction } : {}) };
}

/** The package's own words for a batch refusal. Revalidates its input, so an
 *  internally built object cannot smuggle text either. */
export function batchRefusalGuidance(details: BatchRefusalDetails): {
  text: string;
  error: {
    code: BatchRefusalCode; nextAction: "check_limits"; retryable: false; batchLimit: number; requested: number;
    plan?: PlanLabel; capacityAction?: CapacityAction; upgradeUrl: string;
  };
} {
  const checked = readBatchRefusal(details);
  if (!checked) throw new Error("Invalid batch refusal details");
  const { code, batchLimit, requested, plan, capacityAction } = checked;
  const who = plan ? "the " + plan + " plan" : "this plan";
  const remedy = capacityAction === "contact_support"
    ? "No self-serve plan allows more per request; for a higher limit, use the Enterprise contact on the plans page at " + DEVELOPER_UPGRADE_URL
    : "For a larger batch limit, see plans at " + DEVELOPER_UPGRADE_URL;
  return {
    text: "Error: " + who + " allows " + batchLimit + " symbols per batch request; this request named " + requested + ". "
      + "Split it into requests of " + batchLimit + " or fewer; get_account_status shows this account's limits. " + remedy,
    error: {
      code, nextAction: "check_limits", retryable: false, batchLimit, requested,
      ...(plan ? { plan } : {}), ...(capacityAction ? { capacityAction } : {}), upgradeUrl: DEVELOPER_UPGRADE_URL
    }
  };
}

export interface UsageHint { used: number; limit: number; resetAt: string; threshold: 80 | 95 }

/** A usage warning only at or above 80% of a positive allowance with a real
 *  UTC month reset; null below 80% or on any doubt. */
export function usageWarning(used: unknown, limit: unknown, resetAt: unknown): UsageHint | null {
  const u = safeCount(used, 1e12), l = safeCount(limit, 1e12), reset = safeMonthlyReset(resetAt);
  if (u === undefined || l === undefined || l < 1 || !reset) return null;
  const threshold = u * 100 >= l * 95 ? 95 : u * 100 >= l * 80 ? 80 : undefined;
  return threshold ? { used: u, limit: l, resetAt: reset, threshold } : null;
}

/** Strict: only "used=<int>; limit=<int>; resetAt=<UTC month start>; threshold=80|95",
 *  and only when the stated threshold is the one the numbers actually reach. */
export function parseUsageHeader(value: unknown): UsageHint | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const m = /^used=(0|[1-9]\d{0,12}); limit=([1-9]\d{0,12}); resetAt=(\d{4}-\d{2}-01T00:00:00\.000Z); threshold=(80|95)$/.exec(value);
  if (!m) return null;
  const hint = usageWarning(Number(m[1]), Number(m[2]), m[3]);
  return hint && String(hint.threshold) === m[4] ? hint : null;
}

/** Information for the person, never an instruction to the model. */
export function usageNoteForUser(details: UsageHint): string {
  const hint = usageWarning(details.used, details.limit, details.resetAt);
  if (!hint) throw new Error("Invalid usage hint");
  const percent = Math.min(100, Math.floor((hint.used * 100) / hint.limit));
  return "Note for the user: this Pulse Verity account has used " + hint.used.toLocaleString("en-US") + " of its "
    + hint.limit.toLocaleString("en-US") + " monthly API calls (" + percent + "%). "
    + "The allowance is shared by every key and connected app on the account and resets " + hint.resetAt + " (UTC). "
    + (hint.threshold === 95 ? "Once it is used up, calls are refused until the reset or a plan change. " : "")
    + "Plans and allowances: " + DEVELOPER_UPGRADE_URL;
}

/** Reconstruct metadata rather than forwarding even an internally supplied object. */
export function quotaErrorGuidance(details: QuotaDetails = {}): { text: string; error: QuotaErrorMetadata } {
  if (details.code === "MONTHLY_LIMIT") {
    const resetAt = safeMonthlyReset(details.resetAt);
    const capacityAction = safeCapacityAction(details.capacityAction) ?? "review_plans";
    const capacityGuidance = capacityAction === "contact_support"
      ? "For higher capacity, use the Enterprise contact on the plans page; a higher-capacity self-serve plan may not be available. "
      : "Review available plans and their allowances before choosing an upgrade. ";
    return {
      text: "Error: the monthly API allowance is exhausted. View plans / upgrade: "
        + DEVELOPER_UPGRADE_URL + ". " + capacityGuidance
        + (resetAt ? "Or wait until the quota resets at " + resetAt + ". "
          : "Or wait until the start of the next UTC month for the allowance to reset. ")
        + "A plan change does not reset usage already counted this month. "
        + "Creating or replacing a key does not reset this account's allowance. Do not repeatedly retry. "
        + "Account access and request limits: " + DEVELOPER_ACCOUNT_URL + ".",
      error: {
        code: "MONTHLY_LIMIT", nextAction: "review_access",
        accountUrl: DEVELOPER_ACCOUNT_URL, upgradeUrl: DEVELOPER_UPGRADE_URL,
        capacityAction, ...(resetAt ? { resetAt } : {})
      }
    };
  }
  const retryAfterSeconds = safeRetrySeconds(details.retryAfterSeconds);
  const retry = retryAfterSeconds === undefined ? {} : { retryAfterSeconds };
  if (details.code === "RATE_LIMITED") {
    return {
      text: "Error: the API is temporarily rate limited. " + (retryAfterSeconds === undefined
        ? "Wait before retrying." : "Wait at least " + retryAfterSeconds + " seconds before retrying."),
      error: { code: "RATE_LIMITED", nextAction: "wait", ...retry }
    };
  }
  return {
    text: "Error: the API request limit was reached. " + (retryAfterSeconds === undefined
      ? "Check your account limits before retrying; the type of limit was not provided."
      : "Wait at least " + retryAfterSeconds + " seconds before retrying; the type of limit was not provided."),
    error: { code: "REQUEST_LIMIT", nextAction: retryAfterSeconds === undefined ? "check_limits" : "wait", ...retry }
  };
}
