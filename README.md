# Pulse Verity Index

`pulse-verity` connects an AI agent to the **Pulse Verity Index**: signed,
verifiable crypto index prices through the Model Context Protocol (MCP).

It exposes exactly three read-only tools:

| Tool | Purpose |
|---|---|
| `get_index_price(symbol)` | Return the current signed index value. |
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
- No wallet, account, platform-engine, venue-level, or private repository code.

See [SECURITY.md](SECURITY.md) for reporting instructions.

## Verify locally

```bash
npm ci
npm test
```

The test suite builds the package, checks signed-print verification and negative
cases, and runs the Pulse WORDS vocabulary gate over every emittable string.

## Alternate install names

The following functional redirect packages install and run this same server:
`pulse-verity-index`, `pulseverityindex`, `pulseverity`, `pulse-index`, and
`pulseindex`. They are deprecated in npm metadata so new integrations converge
on the canonical `pulse-verity` name.

## License

MIT
