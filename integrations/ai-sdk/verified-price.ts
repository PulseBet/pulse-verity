import { createMCPClient, type MCPClient, type MCPClientConfig } from '@ai-sdk/mcp';
import { jsonSchema, tool, type ToolExecutionOptions } from 'ai';

type ObjectValue = Record<string, unknown>;
export type TransportFactory = () => MCPClientConfig['transport'];
export const MCP_URL = 'https://mcp.thepulse.markets/api/index/mcp';
const REQUIRED_TOOLS = ['get_index_price', 'verify_print'];
const MAX_RESULT_BYTES = 1024 * 1024;

// Only locally authored messages may reach CLI output or an agent's context.
export class ExampleError extends Error {}

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateSymbol(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9]{1,20}$/i.test(value)) {
    throw new ExampleError('Use a ticker containing 1–20 letters or digits.');
  }
  return value.toUpperCase();
}

export function hostedTransport(key: string | undefined): MCPClientConfig['transport'] {
  const trimmed = key?.trim();
  if (!trimmed || trimmed.length > 4096 || /\s/.test(trimmed)) {
    throw new ExampleError('Hosted MCP requires a valid PULSE_API_KEY environment variable.');
  }
  return { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${trimmed}` } };
}

export function decodeResult(result: unknown): ObjectValue {
  if (!object(result) || result.isError === true) {
    throw new ExampleError('The MCP tool failed; no verified price was produced.');
  }
  let value: unknown = result.structuredContent;
  if (value == null) {
    const blocks = result.content;
    if (!Array.isArray(blocks) || blocks.length !== 1 || !object(blocks[0]) ||
        blocks[0].type !== 'text' || typeof blocks[0].text !== 'string') {
      throw new ExampleError('The MCP tool returned unsupported content.');
    }
    if (Buffer.byteLength(blocks[0].text) > MAX_RESULT_BYTES) {
      throw new ExampleError('The MCP result exceeds the example response limit.');
    }
    try { value = JSON.parse(blocks[0].text); }
    catch { throw new ExampleError('The MCP result is not a JSON object.'); }
  }
  if (!object(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_RESULT_BYTES ||
      'error' in value || value.isError === true || value.success === false) {
    throw new ExampleError('The MCP result was refused. Check access and limits; no automatic retry.');
  }
  return value;
}

function pick(value: unknown, fields: string[]): ObjectValue | null {
  return object(value) ? Object.fromEntries(fields.map(field => [field, value[field] ?? null])) : null;
}

export async function readVerifiedPrice(
  transport: TransportFactory,
  input: unknown,
  externalSignal?: AbortSignal,
) {
  const symbol = validateSymbol(input);
  const deadline = AbortSignal.timeout(90_000);
  const signal = externalSignal ? AbortSignal.any([externalSignal, deadline]) : deadline;
  let client: MCPClient | undefined;
  try {
    signal.throwIfAborted();
    client = await createMCPClient({
      transport: transport(),
      // Pulse 1.3.1 uses initialize; avoid a speculative modern-protocol probe.
      protocolVersionDiscovery: false,
      initializationOptions: { signal, timeout: 30_000 },
    });
    const options = { signal, timeout: 30_000 };
    const discovered = await client.listTools({ options });
    for (const name of REQUIRED_TOOLS) {
      if (discovered.tools.filter(t => t.name === name).length !== 1) {
        throw new ExampleError('The server must advertise each required read/verify tool exactly once.');
      }
    }
    const receipt = decodeResult(await client.callTool({
      name: 'get_index_price', arguments: { symbol }, options,
    }));
    if (receipt.symbol !== symbol || typeof receipt.price !== 'number' ||
        !Number.isFinite(receipt.price) || receipt.price <= 0 ||
        typeof receipt.at !== 'string' || !Number.isFinite(Date.parse(receipt.at)) ||
        typeof receipt.signature !== 'string' || !receipt.signature ||
        typeof receipt.priceText !== 'string' || !object(receipt.v2)) {
      throw new ExampleError('The server did not return a signed record for the requested ticker.');
    }
    // Preserve exact decimal text and all v2 fields; never pass { print: receipt }.
    const verification = decodeResult(await client.callTool({
      name: 'verify_print', arguments: receipt, options,
    }));
    if (verification.recordValid !== true || verification.valid !== true ||
        verification.metadataSigned !== true || verification.verificationScope !== 'full-record') {
      throw new ExampleError('Full-record verification failed; the price was not accepted.');
    }
    return {
      symbol, price: receipt.price, priceText: receipt.priceText, at: receipt.at,
      grade: receipt.grade,
      quality: {
        ...pick(receipt, ['engine', 'sources', 'tier', 'confidence', 'dispersionBps']),
        interval: pick(receipt.interval, ['lower', 'upper']),
        cadence: pick(receipt.cadence, [
          'band', 'calculatedAgeMs', 'newestSourceAgeMs', 'oldestSourceAgeMs', 'p50UpdateMs', 'p95UpdateMs',
        ]),
      },
      recordValid: true as const,
      verificationScope: 'full-record' as const,
      unsignedContext: { sample: receipt.sample === true },
      freshnessAssessed: false as const,
    };
  } catch (error) {
    if (error instanceof ExampleError) throw error;
    throw new ExampleError('The MCP connection or request failed. Check access, limits and connectivity; no verified price was produced.');
  } finally {
    if (client) {
      try { await client.close(); }
      catch { throw new ExampleError('The MCP connection could not close cleanly.'); }
    }
  }
}

/** Server-side only. Agents receive one tool whose code always verifies first. */
export function createVerifiedPriceTool(transport: TransportFactory) {
  const execute = async ({ symbol }: { symbol: string }, { abortSignal }: ToolExecutionOptions<{}>) =>
    readVerifiedPrice(transport, symbol, abortSignal);
  const definition = tool({
    description: 'Read a Pulse Verity Index crypto price and verify its full signed record. ' +
      'Includes observation time and quality. Verification does not establish freshness or settlement suitability.',
    inputSchema: jsonSchema<{ symbol: string }>({
      type: 'object', properties: { symbol: { type: 'string', pattern: '^[A-Za-z0-9]{1,20}$' } },
      required: ['symbol'], additionalProperties: false,
    }),
    execute,
  });
  // Preserve this example's non-streaming return type for direct CLI execution.
  return { ...definition, execute };
}
