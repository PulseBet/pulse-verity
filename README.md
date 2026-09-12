# Pulse Verity Index

`pulse-verity` connects an AI agent to the **Pulse Verity Index**: signed,
verifiable crypto index prices through the Model Context Protocol (MCP).

It exposes five read-only tools:

| Tool | Purpose |
|---|---|
| `get_index_price(symbol)` | Return the current signed index value. |
| `get_index_batch(symbols)` | Read 1–100 symbols with signed successful rows and per-symbol errors. |
| `list_index_assets(limit, offset, band?, status?)` | Discover one catalog page with coverage and measured cadence. |
| `get_settlement_print(symbol, at)` | Return the recorded signed print nearest a moment. |
| `verify_print(print)` | Verify a print locally with ECDSA and the published public key. |

There are no write tools. This package contains no Pulse platform engine code.
It only calls the public Pulse Verity Index API.

## Try it without a key

The server starts and answers with no configuration at all. Keyless, it serves
`get_index_price` for BTC, ETH and SOL from the free sample:

```bash
claude mcp add pulse-verity -- npx -y pulse-verity
```

Then ask your agent for the Bitcoin index price. Every answer is signed and
verifiable, exactly like a keyed one.

## Add a key for everything else

A free key unlocks 4,800+ assets, batch reads, settlement prints and signature
verification. It takes about a minute at
[thepulse.markets/developers](https://thepulse.markets/developers):

```bash
claude mcp add pulse-verity \
  --env PULSE_API_KEY=pidx_your_key_here \
  -- npx -y pulse-verity
```

For any stdio MCP client:

```json
{
  "mcpServers": {
    "pulse-verity": {
      "command": "npx",
      "args": ["-y", "pulse-verity"],
      "env": { "PULSE_API_KEY": "pidx_your_key_here" }
    }
  }
}
```

## Hosted: nothing to install

The same five tools run on Pulse's side at `https://mcp.thepulse.markets/api/index/mcp`.

- **Claude** (web, desktop, mobile): Settings → Connectors → Add custom connector → paste the URL → Connect, then sign in with your developer email and password.
- **ChatGPT**: Settings → Connectors → Create → paste the URL. Same sign-in.
- **Claude Code**: `claude mcp add --transport http pulse-verity https://mcp.thepulse.markets/api/index/mcp --header "Authorization: Bearer pidx_your_key"`
- **Any client with remote MCP support**: `{ "url": "https://mcp.thepulse.markets/api/index/mcp", "headers": { "Authorization": "Bearer pidx_your_key" } }`

Sign-in is standard OAuth 2.1 (dynamic registration, PKCE). Every hosted call meters against
your key exactly like a REST call. Discovery documents live at `/.well-known/oauth-authorization-server`
and `/.well-known/oauth-protected-resource/api/index/mcp`.

## Install locally in other clients

### Cursor marketplace package

This repository includes `.cursor-plugin/plugin.json` and `mcp.json` for
Cursor's plugin loader. The plugin starts the released `pulse-verity@1.2.4`
package with `npx`; Node.js 18 or newer is required. No platform engine code
or private repository access is included.

The `PULSE_API_KEY` variable is optional and defaults to an empty string, so
BTC, ETH and SOL samples work without a key. Configure a free key through
Cursor's plugin configuration to enable catalogue, batch and settlement-print
requests. Never put a real key in these repository files.

Marketplace availability is subject to Cursor's review. The configuration
below remains available for manual MCP installation.

### Grok Build plugin

Install directly from the public repository:

```bash
grok plugin install PulseBet/pulse-verity --trust
```

Start a new Grok Build session, then ask for the current Bitcoin index price.
The plugin starts `npx -y pulse-verity@1.2.4`; Node.js 18 or newer and npm are
required. BTC, ETH and SOL samples work without an API key. To enable
catalogue, batch and settlement-print requests, set `PULSE_API_KEY` in the
environment that launches Grok Build, then start a new session. Get a free key
at [the developer portal](https://thepulse.markets/developers); never save it
in these repository files.

The `.grok-plugin/plugin.json` manifest explicitly selects
`.grok-plugin/mcp.json`. It exposes the five read-only tools listed above and
adds no hooks, skills, agents, slash commands or filesystem-access tools.
Grok's official marketplace listing is subject to review; this direct GitHub
installation does not depend on listing approval.

The plugin source is fetched from `github.com`. At startup, `npx` may fetch
the pinned package and its dependencies from the configured npm registry
(`registry.npmjs.org` by default). During tool use, the server makes GET
requests only to `https://mcp.thepulse.markets` for price, batch, recorded-print,
catalogue, sample and public-key endpoints under `/api/index/v1/`. A configured
`PULSE_API_KEY` is sent only to that origin for keyed requests; samples and
public-key reads need no credentials. The server does not read project files
or send separate telemetry.

### Gemini CLI extension

Install the public extension without an API-key prompt:

```bash
gemini extensions install https://github.com/PulseBet/pulse-verity --skip-settings
```

Restart Gemini CLI, then ask for the current Bitcoin index price. The extension
starts the released `pulse-verity@1.2.4` package through `npx`; Node.js and npm
must be available. BTC, ETH and SOL samples work without a key. Gemini may warn
that the optional setting is unset; that does not prevent keyless startup.

To enable catalogue, batch and settlement-print requests, configure a free key
using Gemini's sensitive-setting prompt, then restart the CLI:

```bash
gemini extensions config pulse-verity PULSE_API_KEY
```

Do not add a real key to this repository or assume an exported shell variable
will pass through Gemini's environment filtering. The extension declares only
`PULSE_API_KEY`, stored through Gemini's sensitive settings.

The root `gemini-extension.json` is the gallery manifest. The release includes
separate `darwin`, `linux` and `win32` archives for Gemini's download selection;
the Claude Desktop `.mcpb` remains separate. Gallery indexing is handled by
Google and is not immediate or guaranteed. This is a Gemini CLI extension,
not a listing in the consumer Gemini chat app.

### Manual MCP configuration

All of these run `npx -y pulse-verity` with `PULSE_API_KEY` in the environment.

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.pulse-verity]
command = "npx"
args = ["-y", "pulse-verity"]
env = { PULSE_API_KEY = "pidx_your_key" }
```

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`, and **Cursor** — `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "pulse-verity": { "command": "npx", "args": ["-y", "pulse-verity"], "env": { "PULSE_API_KEY": "pidx_your_key" } } } }
```

**VS Code (Copilot agent mode)** — `.vscode/mcp.json`:

```json
{ "servers": { "pulse-verity": { "type": "stdio", "command": "npx", "args": ["-y", "pulse-verity"], "env": { "PULSE_API_KEY": "pidx_your_key" } } } }
```

**Gemini CLI** — `~/.gemini/settings.json`, same `mcpServers` block as Cursor.

## Claude Desktop: one-click install

Download [`pulse-verity-1.2.4.mcpb`](https://github.com/PulseBet/pulse-verity/releases/download/v1.2.4/pulse-verity-1.2.4.mcpb),
open it with Claude Desktop (macOS or Windows), and leave the optional key blank
to try BTC, ETH and SOL. Add a free key for catalogue, batch and settlement-print
requests. The bundle contains the same compiled server modules npm ships, with its runtime
dependencies. Existing downloaded bundles must be replaced with the new release.

## Where to find it

- npm: [`pulse-verity`](https://www.npmjs.com/package/pulse-verity)
- Official MCP Registry: `io.github.PulseBet/pulse-verity`
- Cursor: `.cursor-plugin/plugin.json` packages the MCP for marketplace review; manual MCP configuration is shown above
- Grok Build: `.grok-plugin/plugin.json` packages the MCP for direct GitHub installation and marketplace review
- Gemini CLI: `gemini-extension.json` packages the public MCP for the extension gallery and GitHub installation
- Claude Desktop: add the JSON block above to `claude_desktop_config.json`
- Smithery: `smithery.yaml` in this repo declares the stdio command and the one key it needs

Local installations run the same npm package and send a configured developer
key only to the pinned Pulse Verity API. The separate hosted MCP endpoint is
documented above.

## Security boundary

- Read-only MCP tools only.
- API origin pinned to the public Pulse Verity Index API.
- Developer key read from local configuration and sent only to that API.
- Print verification happens locally using ECDSA P-256/SHA-256.
- HTTP requests use a 15-second timeout, a 1 MiB response limit and no redirects.
- Verification accepts at most 16 published keys; refreshes coalesce and are limited to once per 30 seconds.
- API failures retain only allowlisted quota codes and bounded retry delays, never raw remote bodies, headers or transport errors. Returned credentials are redacted.
- No wallet, account, platform-engine, venue-level, or private repository code.

See [SECURITY.md](SECURITY.md) for reporting instructions.

## Signed prices and catalog data

Price and batch tools use the existing signed `/api/index/v1/price` and
`/api/index/v1/batch` endpoints. A successful row can include `priceText`, `kid`,
`tier`, `confidence`, `dispersionBps`, `interval`, `sources`, `engine` and
`cadence`. Preserve `priceText` and `kid` when passing it to `verify_print`.

The immutable `pulse-index-v1` signature authenticates only this payload:

```text
pulse-index-v1
<symbol>
<priceText if present, otherwise String(price)>
<at>
<grade>
```

`verify_print` rejects conflicting `price` and `priceText` values. It selects
the published public key matching `kid`; legacy prints without `kid` are tried
against the bounded published key ring. The ring is cached for five minutes,
with a bounded refresh after a failed check. Legacy public-key responses
containing only `publicKeyPem` still work for prints without `kid`. Verification
is local, but the public keys are initially trusted through Pulse's pinned
HTTPS endpoint. A key that is no longer published cannot verify an old print
through this tool.

`valid: true` authenticates the canonical price fields. It does not authenticate
`kid`, quality, confidence, dispersion, interval, source counts, cadence, batch
status or archive `deltaMs`. Check `deltaMs` before using a sampled historical
print for a particular moment.

The asset tool calls `/api/index/v1/verity/catalog`. It defaults to 50 rows,
accepts `limit` from 1 to 100 and `offset` from 0 to 100000, and never fetches
additional pages automatically. Its rows and any displayed prices are unsigned.
Use the price or batch tool to obtain signed receipts. Catalog coverage changes;
a listed asset or a catalog total does not guarantee a fresh price. Unavailable
prices are not zero. API tier limits can be lower than the tool's batch limit.

## Request limits and upgrades

HTTP 429 tool errors include `structuredContent.error`. `RATE_LIMITED` means
wait, with `retryAfterSeconds` when supplied. `MONTHLY_LIMIT` means the monthly
allowance is exhausted: wait for reset or ask the account owner to review an
upgrade at [the developer portal](https://thepulse.markets/developers).
The owner must approve plan and payment changes; these read-only tools never
purchase an upgrade. Unknown limits use `REQUEST_LIMIT` without assuming a
monthly allowance or recommending payment. No tool automatically retries.

## Verify locally

```bash
npm ci
npm test
```

`npm run check:cursor` checks the Cursor manifest, optional-key configuration,
package-version pin and logo without building or making network requests.
`npm run check:grok` checks the Grok manifest, explicit MCP path, optional-key
configuration and package-version pin without building or network requests.
`npm run check:gemini` checks the Gemini manifest, optional sensitive setting,
version pin and release configuration without building or network requests.
The Gemini extension workflow runs the complete suite, installs with Gemini CLI,
and checks the installed manifest's five read-only MCP tools against a local
candidate tarball before npm publication. The package release publishes the
desktop bundle and all three Gemini archives together. A manual Gemini-only
step can add missing archives to an existing release without replacing assets.
The post-release check installs the default public GitHub release, reads one
public BTC sample and verifies its signature.

The offline suite compiles this small MCP package, exercises exact-price and
rotated-key verification, tests MCP tool bounds and mocked HTTP limits, and runs
the Pulse WORDS vocabulary gate. It needs no API key or live market-data calls.

## Alternate install names

Use `pulse-verity` for supported installs and updates. Other similarly named
packages are not a guarantee of availability or release parity.

## License

MIT
