/** Wire contracts for both MCP transports. Keep this file in sync with the
 * public pulse-verity package; no pricing, storage or authentication here. */
import { z } from 'zod';

const finite = z.number().finite();
const count = z.number().int().nonnegative();
const text = (n: number) => z.string().max(n);
const timestamp = z.string().max(40).refine(v => Number.isFinite(Date.parse(v)), 'Invalid timestamp');
const signature = z.string().length(88).regex(/^[A-Za-z0-9+/]{86}==$/);
const kid = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
export const cadenceSchema = z.object({
  band: z.enum(['real-time', 'five-second', 'ten-second', 'slow', 'unavailable']),
  calculatedAgeMs: finite.nullable(), newestSourceAgeMs: finite.nullable(),
  oldestSourceAgeMs: finite.nullable(), p50UpdateMs: finite.nullable(), p95UpdateMs: finite.nullable(),
  updatesLast120s: count.optional()
});
export const signedPrintSchema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9]{1,20}$/), price: finite.positive(),
  priceText: z.string().min(1).max(100).optional(), at: timestamp,
  grade: z.enum(['consensus', 'blended', 'indicative', 'composite', 'single-source']),
  signature, kid: kid.optional(), sig: z.literal('pulse-index-v1').optional(),
  success: z.literal(true).optional(), engine: text(64).nullable().optional(),
  sources: count.nullable().optional(), tier: text(20).nullable().optional(),
  confidence: finite.nullable().optional(), dispersionBps: finite.nullable().optional(),
  interval: z.object({lower: finite.nullable(), upper: finite.nullable()}).nullable().optional(),
  cadence: cadenceSchema.nullable().optional(),
  v2: z.object({sig: z.literal('pulse-index-v2'), canonical: z.string().min(1).max(8192), signature, kid}).optional(),
  // Keyless local-package responses carry these three unsigned fields.
  sample: z.literal(true).optional(), note: text(2048).optional(), getKey: text(256).optional()
});
export const batchSchema = z.object({
  success: z.literal(true), requested: count.max(100), returned: count.max(100),
  observations: z.array(z.union([
    signedPrintSchema.extend({success: z.literal(true)}),
    z.object({success: z.literal(false), symbol: text(20), code: text(80), message: text(512)})
  ])).max(100)
});
export const catalogSchema = z.object({
  engine: text(64), total: count, count: count.max(100),
  bands: z.array(cadenceSchema.shape.band).max(5), note: text(2048),
  rows: z.array(z.object({
    symbol: text(128), status: z.enum(['consensus', 'blended', 'indicative', 'insufficient-coverage',
      'venue-disagreement', 'unconvertible-quote', 'stale', 'kernel-rejected']),
    price: finite.positive().nullable(), at: timestamp.nullable(), venues: count, freshVenues: count,
    quotes: z.array(text(32)).max(100), cadence: cadenceSchema, ambiguousTicker: z.boolean().nullable()
  })).max(100)
});
export const verificationSchema = z.object({
  valid: z.boolean().describe('Legacy price-only signature check. Use recordValid for quality metadata.'),
  recordValid: z.boolean().describe('Both signatures and every required v2 field verified. Does not prove freshness or settlement suitability.'),
  verificationScope: z.enum(['full-record', 'price-only', 'invalid']),
  metadataSigned: z.boolean(), verifiedWithKid: kid.nullable(), checked: text(512), keySource: text(256),
  v2: z.object({valid: z.boolean(), signatureValid: z.boolean(), fieldsMatch: z.boolean(),
    mismatches: z.array(text(80)).max(18),
    signedFields: z.record(z.union([z.string(), finite, z.boolean(), z.null()])).nullable(),
    verifiedWithKid: kid.nullable()
  }).nullable().optional()
});
export const errorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
  nextAction: z.enum(['wait', 'review_access', 'check_limits', 'reconnect', 'check_input', 'choose_another_symbol', 'report_issue', 'get_key']),
  retryable: z.boolean().optional(), retryAfterSeconds: z.number().int().min(1).max(86400).optional(),
  accountUrl: z.literal('https://thepulse.markets/developers/access').optional(),
  upgradeUrl: z.literal('https://thepulse.markets/developers#/portal/pricing').optional(),
  // NO_KEY and KEY_REQUIRED: the developer sign-up page, built by the adapter, never relayed.
  getKeyUrl: z.string().max(256).regex(/^https:\/\/thepulse\.markets\/developers(?:[/?#][^\s]*)?$/).optional(),
  hostedServerUrl: z.literal('https://mcp.thepulse.markets/api/index/mcp').optional(),
  // MONTHLY_LIMIT resets on a UTC month boundary; KEY_REQUIRED on the next UTC day.
  resetAt: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/).optional(),
  capacityAction: z.enum(['review_plans', 'contact_support']).optional(),
  // TOO_MANY_SYMBOLS / BATCH_TOO_LARGE (1.3.4): the plan's per-request limit and the count sent.
  batchLimit: z.number().int().min(1).max(100_000).optional(),
  requested: z.number().int().min(1).max(100_000).optional(),
  plan: z.enum(['Developer', 'Basic', 'Builder', 'Commercial', 'Enterprise']).optional()
});
export const requestIdSchema = z.string().uuid().describe('Identifier for this MCP call; not a signed price field.');
export const successSchemas = {
  get_index_price: signedPrintSchema,
  get_index_batch: batchSchema,
  list_index_assets: catalogSchema,
  // get_settlement_print is the earlier name of this tool and shares this contract.
  get_recorded_print: signedPrintSchema.extend({
    // Recorded rows retain the cadence band, not live delivery-age measurements.
    cadence: cadenceSchema.partial().required({band: true}).nullable().optional(),
    qualityRecorded: z.boolean().optional(),
    kind: z.literal('daily-close').optional(), assetId: text(160).nullable().optional(),
    closeDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    deltaMs: finite.nonnegative()
  }),
  verify_print: verificationSchema
};
export type ReadToolName = keyof typeof successSchemas;

const monthlyReset = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01T00:00:00\.000Z$/);
/** GET /api/index/v1/account (get_account_status, 1.3.4). Keyed, never metered.
 * The adapter outputs only these fields and writes upgradeUrl itself. */
export const accountStatusSchema = z.object({
  success: z.literal(true),
  plan: z.string().regex(/^[A-Z][A-Za-z]{1,19}$/).describe('The plan name customers see, e.g. Developer'),
  used: count.describe('Calls counted this UTC month, account-wide'),
  limit: count.describe('The monthly allowance'), remaining: count,
  resetAt: monthlyReset, perMinute: count, batchMaxSymbols: count,
  capacityAction: z.enum(['review_plans', 'contact_support']).optional(),
  upgradeUrl: z.literal('https://thepulse.markets/developers#/portal/pricing')
});

const nullableFinite = finite.nullable();
const identity = z.object({
  assetId: text(240), symbol: text(128).optional(), identityType: z.enum(['native', 'contract']).optional(),
  namespace: text(80).nullable().optional(), nativeId: text(160).nullable().optional(),
  network: text(80).nullable().optional(), contractAddress: text(160).nullable().optional()
});
const spread = z.object({ minimum: nullableFinite, average: nullableFinite }).nullable().optional();
export const HISTORY_MAX_ROWS = 1000;
/** GET /api/index/v1/history (get_index_history, 1.3.4). Candles and metrics are
 * unsigned summaries. verifiedObservations rows carry the v1 price signature
 * only; a row's price is its exact signed text. */
export const historySchema = z.object({
  success: z.literal(true),
  symbol: z.string().regex(/^[A-Za-z0-9]{1,20}$/),
  asset: identity.nullable().optional(),
  identityBinding: z.enum(['legacy-symbol-only', 'canonical-asset-id']).optional(),
  dataset: text(64), contemporaneouslySigned: z.boolean(), note: text(2048).optional(),
  provenance: z.object({
    sourceClass: text(128).optional(), methodologyVersions: z.array(text(64)).max(20).optional(),
    signedObservations: count.optional(), totalObservations: count.optional(),
    coverage: spread, confidence: spread
  }).optional(),
  interval: z.enum(['1m', '5m', '1h', '1d']),
  from: timestamp, to: timestamp, rangeClamped: z.boolean(),
  verifiedArchiveSince: timestamp.optional(),
  pagination: z.object({
    limit: count.max(5_000), nextCursor: z.string().max(2_048).regex(/^[A-Za-z0-9_-]+$/).nullable(), truncated: z.boolean(),
    coverage: z.object({
      requestedFrom: timestamp.optional(), requestedTo: timestamp.optional(), returned: count.optional(),
      earliestReturnedAt: timestamp.nullable().optional(), latestReturnedAt: timestamp.nullable().optional(),
      scanComplete: z.boolean().optional(), verificationComplete: z.boolean().optional(),
      unverifiableRows: count.optional(), truncationReason: z.enum(['item-limit', 'block-scan-limit']).nullable().optional(),
      availableFrom: timestamp.nullable().optional(), availableTo: timestamp.nullable().optional()
    }).optional()
  }),
  metrics: z.object({
    periodReturn: nullableFinite, annualizedVolatility: nullableFinite, maxDrawdown: nullableFinite,
    observationCount: count, candleCount: count
  }).optional(),
  verifiedObservations: z.array(z.object({
    assetId: text(240).optional(), symbol: z.string().regex(/^[A-Za-z0-9]{1,20}$/),
    price: z.string().min(1).max(100).regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/),
    at: timestamp, grade: text(20).nullable(), signature: signature.nullable(), kid: kid.nullable(),
    identityBinding: z.literal('legacy-symbol-only').optional()
  })).max(HISTORY_MAX_ROWS).optional(),
  candles: z.array(z.object({
    at: timestamp, open: finite, high: finite, low: finite, close: finite, observations: count,
    coverage: finite.optional(), confidence: finite.optional()
  })).max(HISTORY_MAX_ROWS)
});

/** MCP SDKs require an object root. The declared object admits the bounded
 * error alternative while retaining legacy success fields at their old paths.
 * The adapter additionally validates the complete success shape before output;
 * malformed upstream data must become an error, never a partial/zero price. */
export function toolOutputShape(name: ReadToolName) {
  return {...successSchemas[name].partial().shape, requestId: requestIdSchema, error: errorSchema.optional()};
}
export function validateToolSuccess(name: ReadToolName, value: unknown): Record<string, unknown> {
  successSchemas[name].parse(value);
  return value as Record<string, unknown>;
}
