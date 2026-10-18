# Connecting Pulse Verity

Pick one route. Check the client's existing MCP configuration first and do not
add a duplicate server. The person enters any key in the client's private
settings; never ask for it in chat and never write a real key into a committed
file.

## Hosted MCP (sign in, no key to copy)

URL: `https://mcp.thepulse.markets/api/index/mcp` (Streamable HTTP, OAuth 2.1
with dynamic client registration and PKCE). Signing in creates or opens the
person's Pulse Verity developer account. Hosted reads of prices, recorded
prints and history count against that account's allowance, like REST calls.
`get_account_status` and `get_upgrade_options` do not count, and `verify_print`
checks signatures against the published key ring.

- **Claude (web, desktop, mobile):** Settings, Connectors, Add custom connector,
  paste the URL, Connect, then sign in.
- **ChatGPT:** Settings, Connectors, Create, paste the URL, then sign in.
- **Claude Code:**

  ```bash
  claude mcp add --transport http pulse-verity https://mcp.thepulse.markets/api/index/mcp
  ```

  Then run `/mcp` in Claude Code and sign in.
- **Cursor and other clients with remote MCP:**

  ```json
  { "mcpServers": { "pulse-verity": { "url": "https://mcp.thepulse.markets/api/index/mcp" } } }
  ```

A client without OAuth can send an existing developer key as an
`Authorization: Bearer <key>` header, configured privately by the person.

## npm package (local stdio)

Needs Node.js 18 or newer. Pin the exact version you reviewed, for example
`pulse-verity@<version>`.

- **Claude Code:**

  ```bash
  claude mcp add pulse-verity -- npx -y pulse-verity
  ```

- **Cursor, Windsurf, Claude Desktop, Gemini CLI** (`mcpServers` block):

  ```json
  { "mcpServers": { "pulse-verity": { "command": "npx", "args": ["-y", "pulse-verity"] } } }
  ```

- **Codex CLI** (`~/.codex/config.toml`):

  ```toml
  [mcp_servers.pulse-verity]
  command = "npx"
  args = ["-y", "pulse-verity"]
  ```

- **VS Code** (`.vscode/mcp.json`):

  ```json
  { "servers": { "pulse-verity": { "type": "stdio", "command": "npx", "args": ["-y", "pulse-verity"] } } }
  ```

Without `PULSE_API_KEY` the package serves a limited number of keyless BTC, ETH
and SOL samples per UTC day, and `verify_print` works. Catalogue, batch,
recorded prints, history, account status and feedback need a developer key in
`PULSE_API_KEY`, set by the person in the client's private environment
settings, followed by a client restart.

## Developer account

Sign up at `https://thepulse.markets/developers` (Developer plan, no charge;
Continue with Google skips the email step). Plans and limits:
`https://thepulse.markets/developers#/portal/pricing`. The account holder makes
any purchase in the portal.

## Checking signatures without the tools

- Published key ring: `https://thepulse.markets/.well-known/pulse-verity-keys.json`
- Same keys from the API: `https://mcp.thepulse.markets/api/index/v1/pubkey`
- The `pulse-verity` README section "Signed prices and catalog data" lists the
  signed fields for each record format:
  `https://github.com/PulseBet/pulse-verity#signed-prices-and-catalog-data`
