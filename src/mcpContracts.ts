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
  nextAction: z.enum(['wait', 'review_access', 'check_limits', 'reconnect', 'check_input', 'choose_another_symbol', 'report_issue']),
  retryable: z.boolean().optional(), retryAfterSeconds: z.number().int().min(1).max(86400).optional(),
  accountUrl: z.literal('https://thepulse.markets/developers/access').optional()
});
export const requestIdSchema = z.string().uuid().describe('Identifier for this MCP call; not a signed price field.');
export const successSchemas = {
  get_index_price: signedPrintSchema,
  get_index_batch: batchSchema,
  list_index_assets: catalogSchema,
  get_settlement_print: signedPrintSchema.extend({deltaMs: finite.nonnegative()}),
  verify_print: verificationSchema
};
export type ReadToolName = keyof typeof successSchemas;

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
