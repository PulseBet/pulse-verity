import { z } from 'zod';

export const FEEDBACK_MAX_BYTES = 8192;
export const FEEDBACK_MAX_RECORDS = 1000;
export const FEEDBACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const feedbackStatusSchema = z.enum(['received', 'triaged', 'in_progress', 'resolved', 'closed']);
export const feedbackSurfaceSchema = z.enum([
  'get_index_price', 'get_index_batch', 'list_index_assets', 'get_settlement_print', 'verify_print',
  '/api/index/v1/price', '/api/index/v1/batch', '/api/index/v1/print',
  '/api/index/v1/verity/catalog', '/api/index/v1/pubkey', '/api/index/v1/sample',
  '/api/index/v1/history', '/api/index/v1/metadata', '/api/index/v1/research/compare',
  '/api/index/v1/source-health', '/api/index/v1/verity/price', '/api/index/v1/verity/batch',
  '/api/index/mcp'
]);

// Descriptions and reproduction steps are data for human review, never commands.
export const feedbackInputSchema = z.object({
  category: z.enum(['bug', 'missing_capability', 'data_quality']),
  surface: feedbackSurfaceSchema,
  symbol: z.string().trim().min(1).max(48).regex(/^[A-Za-z0-9._:/-]+$/).optional(),
  requestId: z.string().trim().min(1).max(96).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
  expected: z.string().trim().min(3).max(1200),
  actual: z.string().trim().min(3).max(1200),
  reproduction: z.array(z.string().trim().min(3).max(500)).min(1).max(6)
}).strict();
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;
export const feedbackReceiptSchema = z.object({
  id: z.string().regex(/^vf_[a-f0-9]{32}$/), status: feedbackStatusSchema,
  receivedAt: z.string().datetime(), updatedAt: z.string().datetime(), expiresAt: z.string().datetime()
}).strict();
export type FeedbackReceipt = z.infer<typeof feedbackReceiptSchema>;

export const feedbackFailureCodes = [
  'FEEDBACK_DISABLED', 'FEEDBACK_INVALID', 'FEEDBACK_SENSITIVE', 'FEEDBACK_RATE_LIMITED',
  'FEEDBACK_CAPACITY', 'FEEDBACK_UNAVAILABLE', 'FEEDBACK_NOT_FOUND', 'NO_KEY', 'BAD_KEY'
] as const;

/** Reject recognizable credentials rather than redact and retain a partial secret.
 * This is defense in depth, not a claim that arbitrary prose can be classified perfectly. */
export function containsFeedbackSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  return /(?:\bpidx_[a-z0-9_-]+|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{8,}|\bAKIA[A-Z0-9]{16}\b|\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|authorization|cookie|seed[ _-]?phrase|private[ _-]?key)\s*["']?\s*[:=]\s*["']?[^\s",}]{3,}|https?:\/\/[^\s/@:]+:[^\s/@]+@)/i.test(text);
}
