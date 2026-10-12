# Agent and workflow integrations

Connect applications to the existing Pulse Verity Index. These examples reuse
the public MCP service and package; they do not run another price feed.

| Client | Starting point |
|---|---|
| n8n | [Manual price-and-verification workflow](n8n/) |
| LangChain / LangGraph | [Python examples](python/) |
| Google ADK | [Python examples](python/) |
| CrewAI | [Python examples](python/) |
| Dify | [Read-only plugin source](dify/) |
| Flowise | [Custom MCP connection](flowise/) |
| Langflow | [MCP Tools connection](langflow/) |
| Gemini CLI, VS Code / GitHub Copilot, Cursor, Windsurf, Codex, Claude | [Existing client setup](../README.md#install-locally-in-other-clients) |

Source availability, successful local validation, and acceptance into a vendor's
catalog are different milestones. Each example documents its verification limits.
These directories do not establish marketplace approval.

## Authentication and costs

The hosted endpoint is `https://mcp.thepulse.markets/api/index/mcp`.
Use your own developer credential from
[thepulse.markets/developers](https://thepulse.markets/developers) in the client's
credential store. Never put a real key in an exported workflow or public example.
API calls use the account's existing quota. A client or model provider may charge
separately. Examples do not buy credits, change a subscription, or transfer funds.

For a keyless BTC, ETH or SOL demonstration, use the published stdio package
`pulse-verity@1.3.1` where the client supports local processes. Hosted access
requires authentication; keyless stdio behavior does not imply a keyless hosted
endpoint.

## Verify before describing a record as verified

1. Call `get_index_price` with an explicit asset symbol.
2. Preserve the returned signed fields, including `priceText` and the entire `v2`
   block. Pass them as the top-level arguments to `verify_print`.
3. Require `recordValid === true` before trusting the complete signed record.
   `valid === true` alone authenticates only the older price signature.
4. Keep the observation timestamp and quality data with the result. A signature
   authenticates a record; it does not prove present freshness, market accuracy,
   or suitability for a particular execution or settlement.

The deterministic Python, n8n and Dify examples implement this gate in code.
An instruction to an LLM to verify is not an equivalent enforcement mechanism.
The low-code connection guides explicitly distinguish the two.

An authentication failure, quota response, stale observation, unavailable symbol,
or verification failure must remain an error. Never substitute a zero price or
invent a successful response. Do not automatically retry quota failures.

## Scope

Select only `get_index_price` and `verify_print` for the basic example. Discovery
and batch reads can be added deliberately. The private feedback tool is not
needed for a price workflow. No example needs trading or wallet permissions.
