# Template listing draft — not submitted

Title:

```text
Read and verify a signed crypto price with the Pulse Verity Index
```

Description:

```text
Read one crypto index price through the hosted Pulse Verity MCP service, then verify its complete signed record. This manual n8n workflow outputs VERIFIED only when full-record verification passes and matches the returned observation. Signature integrity does not establish freshness or settlement suitability. Uses built-in MCP Client and Code nodes; no AI model is required. Configure your Verity developer key in n8n's Bearer Auth credential store. Account usage limits apply.
```

Import file: `pulse-verity-signed-price.json`.

Compatibility target: n8n 2.42.6, MCP Client node 1.1. Offline validation only;
n8n editor import and authenticated execution remain unverified. Directory
submission and approval are separate steps; this draft claims neither.
