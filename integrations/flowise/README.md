# Flowise Custom MCP

This is a connection configuration, not an exported chatflow or a marketplace
listing. It follows Flowise's documented Streamable HTTP Custom MCP interface.

1. In your private Flowise workspace, create a variable named `PULSE_API_KEY`
   containing your own Verity developer key. Restrict workspace access and keep
   the key out of exports and shared screenshots.
2. Add **Custom MCP** to your agent and paste [mcp-config.json](mcp-config.json)
   into **MCP Server Config**. The variable reference is resolved by Flowise.
3. Refresh **Available Actions**. Select only `get_index_price` and `verify_print`.
4. Start with one BTC request and inspect the tool trace. The first call should
   return a signed observation; the second must receive that same observation
   and return `recordValid: true` before the agent describes its full record as
   verified. Preserve the timestamp and quality fields in the answer.
5. Treat auth, quota, freshness and verification errors as errors. Do not retry
   quota failures or substitute a price.

Do not embed a key directly into this JSON. This setup does not create a schedule,
activate a workflow, or grant permission to trade.

**Verification limit:** JSON syntax and the fixed destination/credential reference
are checked offline. This configuration has not been imported into an authenticated
Flowise workspace in this repository's verification run. Agent instructions alone
do not enforce verification. For decisions that require a hard verification gate,
use the deterministic [Python](../python/) or [Dify](../dify/) implementation.

Reference: [Flowise's Custom MCP documentation](https://docs.flowiseai.com/tutorials/tools-and-mcp).
