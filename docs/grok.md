# Use Pulse Verity with Grok

Start with a signed BTC, ETH or SOL sample in Grok Build. Add your own Verity
developer key when you need catalogue discovery, batch reads or recorded prints.
Verity's five MCP tools are read-only: they do not trade, transfer funds or
change an account.

## Choose your connection

| You are using | Connection route |
|---|---|
| Grok Build, the coding agent | Install this repository's plugin; try the keyless sample below. |
| Grok Bot, the desktop/mobile app | Check the app's available plugins. A shareable Bot is separate from a plugin listing; see the status below. |
| Your own application using the xAI API | Configure Verity's hosted remote MCP server with your developer key. |

## Grok Build: try a sample without a Verity key

Prerequisites: [Grok Build](https://docs.x.ai/build/overview) installed and
signed in, plus Node.js 18 or newer and npm. Review the
[plugin's security boundary](../README.md#security-boundary) before trusting it.

```bash
grok plugin install PulseBet/pulse-verity --trust
```

Start a new Grok Build session. The plugin starts the pinned public npm package
`pulse-verity@1.2.5`. Leave `PULSE_API_KEY` unset for the keyless sample.

Paste this task into the agent:

```text
Use Pulse Verity's get_index_price separately for BTC, ETH and SOL.
For each successful observation, use verify_print with its original symbol,
price, at, grade and signature, preserving priceText, kid and sig if present.
Show the price, observation timestamp and verification result. Do not invent
missing values or describe an unavailable price as zero. Do not place trades,
start recurring requests or change any account settings.
```

The first price tool call has arguments `{"symbol":"BTC"}`. `verify_print`
takes the receipt fields directly, not a nested `{"print": ...}` object.
Do not use `get_index_batch` for this keyless demo: that tool needs a key.

Look for real tool results, not just a text answer. If no Verity tools appear,
check the plugin is enabled with `grok plugin list`, restart the session, and
use Grok's `/mcps` view to inspect the connection. See the official
[plugin CLI reference](https://docs.x.ai/build/cli/reference) and
[MCP connection view](https://docs.x.ai/build/features/mcp-servers#in-the-tui).

A valid signature authenticates the signed price fields, not the price's
accuracy, freshness or suitability for trading. Cadence, source counts and
other quality metadata are not covered by that signature. See
[what is signed](../README.md#signed-prices-and-catalog-data).

## Add a self-service developer key

1. Open [the Verity developer portal](https://thepulse.markets/developers).
2. Create a developer account, verify your email, then create a key.
3. Set `PULSE_API_KEY` securely in the environment that launches Grok Build,
   then start a new session. Do not paste the key into a chat or commit it.

A free key enables additional reads subject to account limits and coverage.
Try one bounded catalogue request, `list_index_assets` with
`{"limit":10,"offset":0}`, then obtain signed prices with `get_index_price` or
`get_index_batch`. Catalogue rows themselves are unsigned.

If a request reaches a limit, use the returned error and
[account-access guidance](https://thepulse.markets/developers/access).
Review current access options in your account; creating another key does not
reset an account allowance. No tool automatically changes your plan.

## Grok Bot: connection and public sharing are separate

As of September 12, 2026, this repository does **not** provide a verified public
Grok Bot listing or a tested Verity Bot share link. Installing the Grok Build
plugin does not create either one.

Grok Bot documents plugin discovery under Settings → Plugins → Marketplace;
options can vary by account and rollout. Use its
[plugin settings guide](https://docs.x.ai/grok-bot/settings-and-notifications#plugins)
to check what your account can connect. Do not assume Verity is listed there
because it appears in another client's directory.

After a working Verity connection is available, you can create a read-only price
observer and test it with the sample task above. Follow xAI's
[create and share a Bot instructions](https://docs.x.ai/grok-bot/bots).
Public sharing copies the Bot's shared configuration; it does not share your
computer, sign-ins or conversation history. Remove secrets, private URLs and
customer data before sharing. Each recipient must establish their own access.

## xAI API: connect your own agent

The xAI API supports remote MCP separately from the Grok Bot marketplace. Start
from the [official remote MCP example](https://docs.x.ai/developers/tools/remote-mcp)
and configure the following values in your server-side application:

| Setting | Value |
|---|---|
| `server_url` | `https://mcp.thepulse.markets/api/index/mcp` |
| `server_label` | `pulse_verity` |
| `allowed_tools` | Start with `get_index_price` and `verify_print`. |
| `authorization` | A Bearer token using your Verity developer key, supplied from private secret storage. |

The native xAI SDK calls the allowlist `allowed_tool_names`; use the spelling
for your chosen client. The xAI API key authenticates your model request. The
**separate Verity key** authenticates the MCP connection. The hosted endpoint
requires Verity authentication; the local keyless sample is not a hosted free
authentication mode. Model usage and Verity usage have separate limits.

Use the prompt above first, inspect actual tool calls and errors, then add only
the other read tools your application needs. Keep keys out of prompts, shared
Bot profiles and logs. This guide documents the integration parameters, not an
end-to-end xAI API test or an approved marketplace listing.

## Need continuous prices instead?

MCP price reads are individual requests, not continuous WebSocket subscriptions.
For a persistent feed, connect your application's data layer to Verity's
WebSocket API and pass selected observations to your agent as needed. See the
[API reference](https://thepulse.markets/developers#/portal/reference) for
authentication, subscription format and account-specific delivery limits.
