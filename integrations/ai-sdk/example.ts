import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { createVerifiedPriceTool, ExampleError, hostedTransport, validateSymbol } from './verified-price.ts';

try {
  const { values } = parseArgs({ options: {
    transport: { type: 'string', default: 'stdio' },
    symbol: { type: 'string', default: 'BTC' },
  } });
  const symbol = validateSymbol(values.symbol);
  if (values.transport !== 'stdio' && values.transport !== 'http') {
    throw new ExampleError('Use --transport stdio or --transport http.');
  }
  const priceTool = createVerifiedPriceTool(() => values.transport === 'http'
    ? hostedTransport(process.env.PULSE_API_KEY)
    : new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [fileURLToPath(import.meta.resolve('pulse-verity'))],
      // The sample explicitly ignores ambient developer keys and provider tokens.
      env: { PULSE_API_KEY: '' },
      stderr: 'ignore',
    }));
  const result = await priceTool.execute({ symbol }, { toolCallId: 'manual-price-check', messages: [], context: {} });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof ExampleError ? error.message : 'The example could not complete. Check arguments and dependencies.');
  process.exitCode = 1;
}
