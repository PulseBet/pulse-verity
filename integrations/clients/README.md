# Continue and Zed setup

Use the existing Pulse Verity Index MCP package from these clients. These are
manual connection guides, not marketplace approvals or claims of native-client
execution testing. Configuration shapes were checked against the linked official
client documentation on October 12, 2026 Pacific.

Install a supported Node.js/npm runtime first. Both examples launch the pinned
public package with `npx`, which downloads it from npm if needed. An empty
`PULSE_API_KEY` deliberately selects the keyless BTC, ETH and SOL sample, even
when a parent shell contains a developer key. No Pulse credential is needed for
these samples. Your chosen model and client can have their own charges.

## Continue

Create `.continue/mcpServers/pulse-verity.yaml` in your workspace:

```yaml
name: Pulse Verity Index
version: 0.0.1
schema: v1
mcpServers:
  - name: Pulse Verity Index
    command: npx
    args: ["-y", "pulse-verity@1.3.1"]
    env:
      PULSE_API_KEY: ""
```

Use Continue's Agent mode to access MCP tools. Keep tool approval controls in
place. For authenticated access, use Continue's documented secret mechanism
instead of committing a real key to this file. Review the account allowance
before changing from the sample to authenticated requests.

References: [MCP configuration](https://docs.continue.dev/reference#mcpservers) ·
[Configuration locations and secrets](https://docs.continue.dev/guides/configuring-models-rules-tools).

## Zed

In Settings → AI → MCP Servers, choose Add Server → Add Local Server.
Merge this entry into your existing settings; preserve all other settings:

```json
{
  "context_servers": {
    "pulse-verity": {
      "command": "npx",
      "args": ["-y", "pulse-verity@1.3.1"],
      "env": { "PULSE_API_KEY": "" }
    }
  }
}
```

Check that Zed reports the server active before using it. Review tools and
permissions in the intended agent profile. This configuration does not grant
blanket automatic approval to tool calls or enable a paid model.

Reference: [Zed MCP setup](https://zed.dev/docs/ai/mcp).

## Read and verify

Select `get_index_price` and `verify_print` for the basic price workflow. The
private feedback tool is unnecessary. Request one BTC observation, then pass
its complete unchanged record to `verify_print`, including `priceText` and `v2`.
Require `recordValid === true` before describing the full record as verified.
A signature authenticates a record; it does not guarantee market accuracy,
freshness or fitness for a financial decision. Keep the timestamp and quality
fields visible. Authentication, quota and verification failures remain errors;
do not substitute zero or repeatedly retry them.

These clients decide when an agent calls a tool. A prompt asking for verification
is not a deterministic enforcement gate. Use the [Dify](../dify/),
[n8n](../n8n/) or [Python](../python/) adapters when that gate must be enforced
in workflow code. No trading or wallet permission is needed.
