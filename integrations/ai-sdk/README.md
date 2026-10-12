# Pulse Verity Index with Vercel AI SDK

A Node.js server-side tool package using `ai@7.0.137` and `@ai-sdk/mcp@2.0.73`.
It supplies one AI SDK tool, `verified_price`, that reads an index price and
checks its full signed record **in code**, before returning a summary to an
agent. The smoke test runs that same tool without a model or model API key.

This is a community integration example, not a Vercel Marketplace approval or
an official Vercel provider. No additional price feed is created.

## Install

Requires Node.js 24+ and AI SDK 7; not an Edge-runtime or browser tool.

```sh
npm install ai@^7.0.137 ai-sdk-tool-pulse-verity
```

Save as `price.mjs` and run `node price.mjs` for a keyless sample:

```js
import { pulseVerity } from 'ai-sdk-tool-pulse-verity';
const tool = pulseVerity({ mode: 'sample' });
console.log(await tool.execute(
  { symbol: 'BTC' }, { toolCallId: 'sample', messages: [], context: {} },
));
```

Sample mode supports BTC, ETH and SOL, ignores ambient developer credentials and
does not promise current live pricing. It starts a temporary pinned MCP child
process, then closes it.

For a hosted agent, set `PULSE_API_KEY` and `AI_GATEWAY_API_KEY` in your server
secret store. Model usage and Verity account quotas are separate.

```js
import { generateText, gateway, isStepCount } from 'ai';
import { pulseVerity } from 'ai-sdk-tool-pulse-verity';
const { text } = await generateText({
  model: gateway('openai/gpt-5-mini'),
  prompt: 'Read and verify a BTC index record. Report its observation time and quality; do not assume it is fresh.',
  tools: { verified_price: pulseVerity() },
  stopWhen: isStepCount(2), maxRetries: 0,
});
console.log(text);
```

Hosted mode requires a developer key and never falls back to sample data. An
optional `apiKey` argument overrides `PULSE_API_KEY`. Each execution opens and
closes its connection. The tool does not retry internally; applications and
models can still call repeatedly, so set your own call and spend limits.

## Run from source

Use Node.js 24 or newer. From this repository:

```sh
cd integrations/ai-sdk
npm ci --ignore-scripts
npm start -- --symbol BTC
```

The default starts the pinned, already-built `pulse-verity@1.3.1` npm package as
a temporary stdio child process and closes it after the request. It does not
start a web server, schedule a job, or call an LLM. BTC, ETH and SOL are the
keyless sample symbols. This mode deliberately ignores any ambient developer
key. The returned `unsignedContext.sample` flag is context, not signed data.

## Use hosted MCP in an application

Put your developer key from [the developer portal](https://thepulse.markets/developers)
in your server's secret store as `PULSE_API_KEY`. Then:

```sh
npm start -- --transport http --symbol BTC
```

Hosted requests use the existing account's quota. The only destination for the
bearer credential is `https://mcp.thepulse.markets/api/index/mcp`; HTTP redirects
are rejected by the adapter. Never put the key in a browser bundle, repository,
prompt, screenshot, chat, or exported workflow. Do not expose a public proxy
using your key without application authentication, rate limits and a budget.

For advanced server-side transport configuration, the package also exports
`createVerifiedPriceTool` and `hostedTransport`:

```ts
import { createVerifiedPriceTool, hostedTransport } from 'ai-sdk-tool-pulse-verity';

const tools = {
  verified_price: createVerifiedPriceTool(() => hostedTransport(process.env.PULSE_API_KEY)),
};
// Supply `tools` to your existing AI SDK agent or generateText configuration.
// Its model calls can cost money; this example does not select or call a model.
```

The server-side wrapper opens and closes a connection for each tool execution.
Keep your model's step count and application request limits bounded. It returns
only a verified summary, not raw remote instructions, feedback tools, secrets,
or unsigned server messages. The wrapper can also be called directly using
`readVerifiedPrice`, without an agent.

## What verification establishes

1. Validate the ticker and discover both required tools.
2. Call `get_index_price` once.
3. Pass the complete original record, including `priceText` and `v2`, as the
   top-level arguments to `verify_print` once.
4. Require `valid`, `recordValid` and `metadataSigned` to be `true`, and
   `verificationScope` to be `full-record`.
5. Return observation time and the signed quality fields. Failures remain
   errors; there is no fabricated zero price or automatic tool retry.

The wrapper trusts the configured Pulse verifier over the fixed HTTPS origin
(or the pinned local package). It does not implement a second price calculation
or cryptographic verifier. A signature authenticates a record, not freshness,
market accuracy, or suitability for trade execution or settlement. The output
explicitly says `freshnessAssessed: false`; enforce your application's age and
quality requirements separately. Unsigned cadence extras are excluded.

Initialization and individual requests have 30-second limits, with a 90-second
overall signal. SDK exceptions and response bodies are replaced with locally
authored errors. The one-megabyte result check applies after SDK decoding; it
is not a network response-size guarantee.

## Verification and maintenance

```sh
npm run typecheck
npm test
```

The offline suite runs the real AI SDK tool and MCP client against a synthetic
in-memory JSON-RPC peer. It checks exact receipt forwarding, structured/text
results, missing/duplicate tools, failed verification, legacy-only verification,
quota errors, malformed prices, cancellation, cleanup and error redaction. A
mocked HTTP transport checks the fixed destination and credential handling.
These tests do not establish successful live hosted authentication.

The dedicated [AI SDK integration workflow](../../.github/workflows/ai-sdk.yml)
does type checking and offline tests. Its optional manual `live_sample` input
runs exactly one keyless BTC read/verify sequence on the disposable CI runner.
No credentials or LLM are required. No schedule is installed.

API references: [AI SDK MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools) and
[AI SDK tools](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool).

Verified on 12 October 2026 at 10:48 Pacific: [CI run 38286700206](https://github.com/PulseBet/pulse-verity/actions/runs/38286700206)
at source commit `084dc2c` passed TypeScript checking, all 17 offline tests, and
one live keyless BTC sequence through the real AI SDK tool and published stdio
package. The live result reported `recordValid: true` and
`verificationScope: "full-record"`. No LLM or developer key was used. Live
authenticated HTTP execution and marketplace acceptance are not established by
this check.


## Package verification

Release CI emits JavaScript and TypeScript declarations, checks an exact seven-file
allowlist, then installs the tarball in a clean directory and executes one keyless
verified BTC call. Offline tests exercise real `generateText` orchestration with
a synthetic model. No paid model call is needed. Publication is manual only.

Integration guide: https://pulsebet.github.io/pulse-verity/ai-sdk/.
