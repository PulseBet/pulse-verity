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

/** Never pass through upstream messages, links, account identifiers or headers. */
export async function readQuotaDetails(response: Response): Promise<QuotaDetails> {
  if (response.status !== 429) return {};
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  const fallback: QuotaDetails = retryAfterSeconds === undefined ? {} : { retryAfterSeconds };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (Number(response.headers.get("content-length")) > MAX_QUOTA_ERROR_BYTES) {
      await response.body?.cancel().catch(() => {});
      return fallback;
    }
    if (!response.body) return fallback;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_QUOTA_ERROR_BYTES) throw new Error("Quota response exceeds its size limit");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
    const code = (body as Record<string, unknown>).code;
    if (code === "MONTHLY_LIMIT") {
      const resetAt = safeMonthlyReset((body as Record<string, unknown>).resetAt);
      const capacityAction = safeCapacityAction((body as Record<string, unknown>).capacityAction);
      return { code, ...(resetAt ? { resetAt } : {}), ...(capacityAction ? { capacityAction } : {}) };
    }
    if (code === "RATE_LIMITED") return { code, ...fallback };
    return fallback;
  } catch {
    await reader?.cancel().catch(() => {});
    return fallback;
  } finally {
    reader?.releaseLock();
  }
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
