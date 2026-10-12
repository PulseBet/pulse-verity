import { fileURLToPath } from 'node:url';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { createVerifiedPriceTool, hostedTransport, ExampleError } from './verified-price.ts';

export { createVerifiedPriceTool, hostedTransport, readVerifiedPrice, ExampleError } from './verified-price.ts';
export type { TransportFactory } from './verified-price.ts';

export type PulseVerityOptions =
  | { mode?: 'hosted'; apiKey?: string }
  | { mode: 'sample'; apiKey?: never };

/** Node.js server only. Sample mode must be selected explicitly. */
export function pulseVerity(options: PulseVerityOptions = {}) {
  if (options.mode === 'sample') {
    if (options.apiKey !== undefined) throw new ExampleError('Sample mode does not accept a developer key.');
    return createVerifiedPriceTool(() => new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [fileURLToPath(import.meta.resolve('pulse-verity'))],
      env: { PULSE_API_KEY: '' },
      stderr: 'ignore',
    }));
  }
  if (options.mode !== undefined && options.mode !== 'hosted') {
    throw new ExampleError('Use hosted or sample mode.');
  }
  // Validate before registering a hosted tool. Never silently fall back to samples.
  const transport = hostedTransport(options.apiKey ?? process.env.PULSE_API_KEY);
  return createVerifiedPriceTool(() => ({ ...transport }));
}
