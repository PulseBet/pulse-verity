# Pulse Verity hosted MCP plugin for Claude

This plugin supplies a guided reference-price workflow and connects to
https://mcp.thepulse.markets/api/index/mcp through remote HTTP MCP.
It uses the host's OAuth flow and the user's own Verity account. It does not
require a local Node.js server or an API key in chat.

The Claude manifest declares the remote `pulse-verity` server inline.
Claude loads root `.mcp.json` first and then the manifest's server map; the
same-name remote entry replaces the local entry for this Claude plugin.
The root configuration remains available for other clients.
See [manifest precedence](https://code.claude.com/docs/en/plugins-reference#mcpservers).

## Connect and use

Install only after the marketplace approves and publishes the listing. Until
then, this source and a saved application do not establish availability.
Sign in through the host's Connect control, review the scopes and approve only
the intended account. The read scope provides market-data tools; optional
feedback scope permits a private support report. Calls count against the
account's applicable allowance. No trades, transfers or billing changes occur.

Ask: “Use Pulse Verity to read BTC and verify its receipt. Show the observation
timestamp and explain what the signature does and does not authenticate.”
Inspect the discovered tool schemas. The current hosted historical tool is
`get_recorded_print`; some older clients use `get_settlement_print`.
Preserve signed fields exactly, report unavailable data honestly, and do not
treat a signature as proof of freshness, economic accuracy or trading suitability.

## Data and support

Only the declared Pulse MCP service receives tool inputs. The service retains
account-linked OAuth, usage and security records under its published policy.
Optional private feedback must omit credentials, personal information and full
conversation transcripts. There are no filesystem, browser-history or trading
tools and no background hooks.

[Privacy](https://thepulse.markets/developers/privacy) ·
[Terms](https://thepulse.markets/developers/terms) ·
support@thepulse.markets

## Validation

The Claude workflow checks the hosted manifest override and the bounded skill,
then validates and loads the plugin with the official Claude CLI without a
model call. The separate stdio package smoke test continues to protect other
clients. These checks do not exercise authenticated Claude tool discovery or
establish directory approval. Verify OAuth and discovered tool schemas in the
target host before declaring the connector ready for publication.
