# Pulse Verity Index

Pulse Verity Index gives agents read-only access to signed crypto reference-price observations. The MCP server exposes current and recorded prices, bounded asset discovery, batch reads, and local signature verification without trading, transfers, or account changes.

## Publisher: Pulse Labs OpCo LLC

## Prerequisites

- Access to a Microsoft environment that supports Streamable HTTP MCP tools.
- A Pulse Verity developer account and active developer key from [the developer portal](https://thepulse.markets/developers).
- The developer key must be supplied through the connection's protected **Authorization** field as `Bearer pidx_your_key`. Do not paste a key into agent instructions, prompts, source control, or this repository.

## Supported Operations

The client discovers these five tools at runtime by calling MCP `tools/list`. All five tools are read-only.

### `get_index_price`

Returns a current signed price receipt for one covered crypto symbol. A stale or unavailable result means that no current observation is available; it never means that the price is zero.

### `get_index_batch`

Reads a bounded batch of 1–100 symbols. Successful rows are signed individually, and unavailable rows return per-symbol errors. The developer account's tier can impose a smaller batch limit.

### `list_index_assets`

Returns one bounded page of the asset catalog with coverage status and measured cadence. Catalog rows and catalog prices are discovery metadata and are not signed.

### `get_settlement_print`

Returns the recorded signed print nearest an ISO-8601 time or epoch-millisecond value. The caller should inspect `deltaMs`, because retention and sampling are bounded.

### `verify_print`

Verifies a signed price receipt with ECDSA P-256 and SHA-256 using Pulse's published key ring. A valid result authenticates the canonical `symbol`, exact price text, `at`, and `grade` fields; it does not assert that other metadata is signed or that a price is accurate or fresh.

## Obtaining Credentials

1. Open [the Pulse Verity developer portal](https://thepulse.markets/developers).
2. Create or sign in to a developer account and verify the account email.
3. Create a developer key.
4. In the connector connection, enter `Bearer ` followed by the key in the protected **Authorization** field.

The connection sends that bearer credential only to `https://mcp.thepulse.markets/api/index/mcp`. Requests count against the connected developer account's current allowance.

The hosted server also supports OAuth 2.1 dynamic client registration with PKCE and discovery. The certification artifact uses the independently supported developer-key route because it requires no embedded client identifier or client secret. Copilot Studio exposes **OAuth 2.0 → Dynamic discovery**, but compatibility with Verity's secretless public-client registration remains pending an end-to-end Microsoft connection test. This package does not claim Microsoft 365 DCR compatibility.

## Getting Started

1. Create the connection with the protected Authorization value described above.
2. Add the server as an MCP tool.
3. Ask the agent to retrieve the current BTC price and verify the returned receipt.
4. Confirm the answer includes the observation timestamp and distinguishes signed fields from unsigned metadata.

## Known Issues and Limitations

- The endpoint is stateless and accepts MCP JSON-RPC messages over `POST`; it doesn't provide resumable `GET` or `DELETE` sessions.
- Asset coverage and cadence can change. A catalog row doesn't guarantee a fresh price.
- Recorded-print retention and sampling are bounded, so the nearest print can differ from the requested time.
- Signature verification depends on the matching public key remaining in the published key ring.
- Developer account rate, monthly, batch, symbol, and retention limits apply. The server doesn't retry automatically.
- MCP responses can be JSON or `text/event-stream`. Validate end-to-end behavior in the MCP client because a generic custom-connector test console might not exercise protocol negotiation.
- The server exposes no trade, wallet, transfer, write, account-management, or key-management tools.

## Deployment Instructions

Import `apiDefinition.swagger.json` and `apiProperties.json` with `icon.png` into a custom connector in a solution. Create the protected connection with an Authorization value in the format `Bearer pidx_your_key`, then add the resulting MCP tool to an agent and confirm `tools/list` returns exactly the five operations documented above.

For certification, run Solution Checker, execute the reviewer cases in `reviewer-evaluation.md`, export the connector and test-flow solutions without modifying their generated contents, assemble the final package with this `intro.md`, and follow `submission-checklist.md`.
