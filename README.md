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
It only calls the public Pulse Verity Index API. The developer supplies their
own API key through `PULSE_API_KEY`.

## Install

Create a developer API key at
[thepulse.markets/developers](https://thepulse.markets/developers), then add the
server to your MCP client:

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

## Security boundary

- Read-only MCP tools only.
- API origin pinned to the public Pulse Verity Index API.
- Developer key read from local configuration and sent only to that API.
- Print verification happens locally using ECDSA P-256/SHA-256.
- HTTP requests use a 15-second timeout, a 1 MiB response limit and no redirects.
- Verification accepts at most 16 published keys; refreshes coalesce and are limited to once per 30 seconds.
- API failures do not echo remote bodies, headers or transport errors. Returned credentials are redacted.
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

## Verify locally

```bash
npm ci
npm test
```

The offline suite compiles this small MCP package, exercises exact-price and
rotated-key verification, tests MCP tool bounds and mocked HTTP limits, and runs
the Pulse WORDS vocabulary gate. It needs no API key or live market-data calls.

## Alternate install names

Use `pulse-verity` for supported installs and updates. Other similarly named
packages are not a guarantee of availability or release parity.

## License

MIT
