# Langflow MCP Tools

These instructions use the existing MCP Tools component. The JSON file is a
server connection for a keyless sample, not an exported starter flow or proof of
catalog acceptance.

## Hosted connection

1. In **Settings → Global Variables**, create a **Credential** variable named
   `PULSE_VERITY_AUTHORIZATION`. Its private value must be `Bearer ` followed by
   your own Verity developer key.
2. Open **Settings → MCP Servers → Add MCP Server**. Choose HTTP/SSE and enter:
   - Name: `pulse-verity`
   - URL: `https://mcp.thepulse.markets/api/index/mcp`
   - Header name: `Authorization`
   - Header value: `PULSE_VERITY_AUTHORIZATION` (the variable name)
3. Save the server. Drag it from the MCP sidebar into your flow. Create separate
   MCP Tools components selecting `get_index_price` and `verify_print`; enable
   Tool Mode and connect their Toolset outputs to your Agent.
4. Inspect one BTC tool trace in the Playground. The second call must preserve
   the first call's signed observation as top-level arguments, including its
   `priceText` and `v2` block. Require `recordValid: true` before describing the
   complete record as verified. Show its observation time and quality fields.
5. Retain authentication, quota and verification failures as errors. Leave TLS
   verification enabled and do not automatically retry quota failures.

Do not forward unrelated incoming credentials to Verity. Do not leave the tool
selection blank if you intend to expose only these two tools.

## Keyless sample

On a runtime with Node.js/npm installed, register the server using the JSON
configuration in [stdio-sample.json](stdio-sample.json). This runs the pinned
public package and supports sample BTC, ETH and SOL observations without a key.
It downloads the package if it is absent. No Docker build is required by this
example; hosted HTTP is preferable if local processes are unavailable.

**Verification limit:** connection JSON is checked offline, and the setup follows
the documented 1.12.x MCP interface. No authenticated Langflow import or exported
starter flow is claimed. An agent prompt is not a deterministic verification gate;
use the [Python examples](../python/) where failure must stop further processing.

References: [MCP client setup](https://docs.langflow.org/mcp-client) ·
[Starter template contribution process](https://docs.langflow.org/contributing-templates).
