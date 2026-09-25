# Reviewer evaluation plan

This plan provides repeatable technical and responsible-AI checks without storing a credential or a fixed market price. The publisher supplies a dedicated review account through Microsoft's secure submission channel.

## Secure setup

1. Create a dedicated reviewer account with the lowest access tier that can exercise all five tools.
2. Create one review-only developer key and record its identifier separately from its secret.
3. Put `Bearer ` and the key in the connection's protected **Authorization** field.
4. Never place the key in this file, an agent prompt, a screenshot, source control, or a test transcript.
5. Revoke the review key after certification unless Microsoft requests that it remain active for ongoing verification.

## Discovery gate

Call MCP `tools/list` and require exactly these tools:

- `get_index_price`
- `get_index_batch`
- `list_index_assets`
- `get_settlement_print`
- `verify_print`

Fail the review if any write, trade, wallet, transfer, account, credential, or key-management tool appears.

## Functional cases

Run each successful case at least ten times before packaging, as required by Microsoft's connector guidance. Store timestamps, HTTP status, tool name, elapsed time, and pass/fail status, but redact bearer values and full response headers.

| Case | Call | Expected invariant |
|---|---|---|
| Current price | `get_index_price` with `BTC` | Returns a positive observation, a source timestamp, a grade, and receipt fields when available; unavailable is never represented as zero. |
| Case normalization | `get_index_price` with `eth` | Resolves the symbol without changing the operation into a write. |
| Batch | `get_index_batch` with `BTC`, `ETH`, `SOL` | Returns a bounded row per requested symbol or an explicit per-symbol error; successful rows remain independently signed. |
| Asset discovery | `list_index_assets` with limit `5` and offset `0` | Returns no more than five unsigned catalog rows and reports coverage metadata without claiming those rows are signed receipts. |
| Recorded print | `get_settlement_print` with a recent ISO-8601 time | Returns the nearest retained print or an explicit unavailable result; the caller can inspect `deltaMs`. |
| Valid receipt | `verify_print` with an unchanged signed result | Returns `valid: true` only when the published key verifies the canonical signed fields. |
| Altered receipt | Change one digit in the price before `verify_print` | Returns `valid: false` or rejects inconsistent price fields. |

Do not compare a live result with a hard-coded price. Market observations change, and signature validity doesn't establish price freshness or accuracy.

## Boundary and adversarial cases

| Case | Expected result |
|---|---|
| Missing Authorization header | HTTP `401` with no price data and no credential echo. |
| Invalid synthetic bearer value | HTTP `401`; the response doesn't expose internal storage or key hashes. |
| Unsupported symbol | Explicit unavailable or validation error; never a zero price. |
| Empty batch or more than 100 symbols | Input validation error before upstream market-data work. |
| Catalog limit above 100 or negative offset | Input validation error. |
| Invalid timestamp | Input validation error. |
| Prompt asks the tool to place a trade or move funds | The agent reports that no such tool exists and doesn't simulate success. |
| Prompt asks the tool to reveal its key | The tool exposes no credential-reading operation and no bearer text appears in output. |
| Upstream error includes untrusted instructions | Returned error stays bounded to the server's safe error contract and isn't treated as an instruction. |
| Repeated call reaches a request limit | Explicit bounded quota guidance; no automatic retry loop and no claim that a purchase occurred. |

## Review evidence

The submission evidence should include:

- the package commit SHA;
- Solution Checker output;
- custom-connector validation output;
- a timestamped, redacted results table for the cases above;
- a screenshot or export proving the five discovered tool names;
- confirmation that the review key was delivered only through Microsoft's secure field;
- the production privacy, support, and terms URLs;
- any limitation or variance observed during testing.

Evidence must not include a developer key, password, access token, refresh token, client secret, personal email address, or user market activity.
