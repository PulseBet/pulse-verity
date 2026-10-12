# Template listing draft — not submitted

Title:

```text
Read and verify a signed crypto price with MCP and Pulse Verity Index
```

Description:

```text
## Who this is for
Developers building crypto data checks who need a signed observation before passing data downstream.

## How it works
A manual run reads one crypto price from the hosted Pulse Verity Index through MCP. It preserves the complete record, asks the same hosted service to verify it, and outputs VERIFIED only when full-record verification matches that exact observation. Errors stop the workflow; calls have timeouts and no automatic retries.

## Setup
Import the workflow. Create a developer key at https://thepulse.markets/developers. Store it in an n8n Bearer Auth credential and select that credential in both MCP Client nodes. Set the symbol in Choose symbol, then run the entire workflow from Run manually.

## Requirements
Use n8n with MCP Client 1.1, Edit Fields 3.4 and Code 2. Verity account limits and n8n hosting costs apply. No AI model or community node is required.

## Customize and use the result
Change the default BTC symbol in Choose symbol. Connect downstream processing after Require verified record. VERIFIED describes signature integrity, not freshness, accuracy or settlement suitability. Check signed timestamps and quality fields separately; indicative data is unsuitable for settlement. Verification trusts the hosted service over HTTPS. Saved execution data is disabled; instance logging policies still apply.
```

Import file: `pulse-verity-signed-price.json`.

The complete description above is also included in the workflow's main sticky
note. Template pricing: **Free**; this does not include n8n hosting or override
Verity account limits.

Compatibility target: n8n 2.42.6, MCP Client node 1.1, Edit Fields 3.4. Offline validation only;
n8n editor import and authenticated execution remain unverified. Directory
submission and approval are separate steps; this draft claims neither.
