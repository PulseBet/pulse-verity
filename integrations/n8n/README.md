# Pulse Verity Index for n8n

Import [pulse-verity-signed-price.json](pulse-verity-signed-price.json) to read one
crypto price and verify its complete signed record. The workflow is inactive,
starts manually, and uses n8n's built-in **MCP Client** as ordinary workflow
steps. No AI model, community node, npm package, or LLM payment is required.
Your n8n hosting and Verity account limits still apply.

## Setup

1. Use an n8n instance with **MCP Client node version 1.1**, **Code version 2**,
   and **Manual Trigger version 1**. The source compatibility target is
   **n8n 2.42.6**. This is a source/schema check, not a completed n8n UI import
   or authenticated execution. Older releases have not been validated.
2. In the editor's workflow menu, choose **Import from File**, then select the
   JSON in this folder. Keep it inactive; this template has no schedule.
3. Create a Verity developer key at
   [the developer portal](https://thepulse.markets/developers), if you do not
   already have one. Hosted MCP requires authentication; the npm package's
   keyless sample mode is a separate installation route.
4. Open **Read signed price**. Authentication is already **Bearer Auth**.
   Create an n8n **Bearer Auth** credential and put the key in **Bearer Token**,
   without adding the word `Bearer`. Select this same credential in
   **Verify exact print**. The export intentionally contains no credential ID,
   credential name, token, environment lookup, or file lookup.
5. In **Choose symbol**, change `BTC` only if needed. Keep the endpoint and tools
   fixed. The tool inputs use JSON mode; `verify_print` receives the preserved
   print fields at the top level, not nested under a `print` property.
6. Execute the **entire workflow** manually. Inspect **Require verified record**.
   A successful output has `status: "VERIFIED"`, the original `signedPrint`,
   authenticated `signedFields`, and the verification key IDs.

The configured origin is `https://mcp.thepulse.markets`; both nodes use
`/api/index/mcp`. A successful run calls `get_index_price` once and
`verify_print` once, plus the protocol connection handshakes. Each tool has a
20-second timeout. Automatic workflow retries are disabled. No data is sent to
an LLM, notification destination, trading service, or feedback tool.

## What VERIFIED means

The final node requires the actual verifier response's **`recordValid === true`**,
alongside its other full-record checks. It binds the verification to this exact
price, timestamp, signing key, and complete live-record field set. Neither
`valid: true` alone nor the string `"true"` passes. The whole `priceText` and
`v2` block remain unchanged between the read and verification call.

Verification is performed by the hosted Pulse Verity MCP service and trusted
over HTTPS. This workflow does not independently fetch public keys or execute
cryptography inside n8n. VERIFIED describes signature integrity; it does not
prove freshness, economic accuracy, or fitness for settlement. Check the signed
`at`, quality and cadence fields for your application's requirements. Indicative
data must not be used for settlement. An older signed observation can still
pass signature verification.

`signedFields` identifies the authenticated values. Extra fields in
`signedPrint`, such as `requestId`, are not thereby authenticated. MCP content is
treated as data; it is never executed as instructions.

The gate deliberately accepts the complete current live-record field set only.
If that signed schema changes, the workflow stops until its field checks and
tests are reviewed and updated; it does not silently accept new record formats.

## Failures and data handling

Missing, malformed, unavailable, v1-only, or altered records stop the execution
with an error. MCP authentication, quota, HTTP and tool failures stop at the
MCP node; the final node does not emit an observation. Never substitute zero
for an unavailable price. For rate limits, wait as directed; for a monthly
allowance error, review [account access](https://thepulse.markets/developers/access)
before trying again. Replacing a key does not reset the allowance.

The export disables saved manual, successful, and failed execution data through
workflow settings. n8n's editor can still show output during the current run;
instance-level logs, retention and administrator access are controlled by your
n8n installation. Keep credentials in its credential store and limit access.
Remove credential references and execution data before sharing any later export.
Do not pin sample data to a production node: pinned or partial executions are
outside this template's verification guarantees. Re-run from the manual trigger.

## Local validation and status

```bash
node --test integrations/n8n/validate.mjs
```

The offline harness walks the exported connections, executes the exact embedded
JavaScript and JSON-input expressions, and replaces only the remote MCP
transport. It verifies the repository's synthetic signed fixture with Node's
crypto library, then tests altered prices/quality, invalid signatures, missing
verification fields, malformed responses and stopped calls without retries.
No live credentials, market-data request or paid model call is involved.

This is a local integration artifact and a [template listing draft](TEMPLATE.md).
It has not been imported into a hosted n8n account, submitted to n8n, accepted
into its template directory, or approved as an official n8n integration.

## Sources checked on 11 October 2026 Pacific

- [n8n MCP Client documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpclient/): regular workflow calls and JSON input mode.
- [n8n 2.42.6 MCP Client source](https://github.com/n8n-io/n8n/blob/n8n%402.42.6/packages/%40n8n/nodes-langchain/nodes/mcp/McpClient/McpClient.node.ts): node version, property names, structured/text output and v1.1 error handling.
- [n8n 2.42.6 transport and credentials](https://github.com/n8n-io/n8n/blob/n8n%402.42.6/packages/%40n8n/nodes-langchain/nodes/mcp/shared/descriptions.ts): HTTP Streamable and Bearer Auth fields.
- [n8n Bearer Auth documentation](https://docs.n8n.io/integrations/builtin/credentials/httprequest/#using-bearer-auth) and [JSON import](https://docs.n8n.io/workflows/export-import/).
- Repository [MCP contracts](../../src/mcpContracts.ts), [tool implementation](../../src/index.ts), and [signed fixture](../../fixtures/verity-agent-print.json).
