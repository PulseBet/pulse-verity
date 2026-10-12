# Langflow: Pulse Price Sample

[pulse-price-sample.json](pulse-price-sample.json) is a native workflow export
targeting **Langflow 1.12.5**. It uses only Core components:

```text
Chat Input (BTC / ETH / SOL) → MCP Tools (get_index_price) → Chat Output
```

There is no Agent or model call. The selected MCP tool reads one observation;
Tool Mode stays off, so no feedback tools are supplied to an Agent. **This flow
does not verify the receipt.** A signature being present is not verification.

## Import and run the sample

1. Import [pulse-price-sample.json](pulse-price-sample.json) into Langflow 1.12.5.
2. The Langflow runtime must have Node.js/npm and permission to start the pinned
   `npx -y pulse-verity@1.3.1` MCP process. This downloads the package if absent.
   Importing the flow does not establish connectivity.
3. Review the **MCP Tools** node. It embeds the supported `{name, config}` server
   value and selects **get_index_price**. Its empty `PULSE_API_KEY` deliberately
   selects the keyless sample, even if the parent process has a developer key.
   Keep Tool Mode off. A runtime policy can require registering/approving the
   same command under **Settings → MCP Servers** first.
4. Open the Playground and send only `BTC`, `ETH`, or `SOL`, not a sentence.
   The input is passed directly as the tool's `symbol` argument. Inspect the
   output and the MCP node's full result, including the observation time,
   quality fields, exact `priceText`, and complete `v2` record when present.
5. Treat transport, quota, authentication, and invalid-symbol failures as
   errors. This flow adds no automatic retry. Chat history storage is disabled
   in both input/output nodes.

No Verity key or paid model is needed for these samples. Langflow hosting may
have its own costs. This is not a settlement or trading decision workflow.

For a deterministic whole-record check, use the [Python examples](../python/),
which pass receipt fields unchanged to `verify_print` and require
`recordValid: true`. Do not claim this sample's displayed record is verified.

## Hosted connection

1. In **Settings → Global Variables**, create a **Credential** variable named
   `PULSE_VERITY_AUTHORIZATION`. Its private value must be `Bearer ` followed by
   your own Verity developer key.
2. Open **Settings → MCP Servers → Add MCP Server**. Choose HTTP/SSE and enter:
   - Name: `pulse-verity`
   - URL: `https://mcp.thepulse.markets/api/index/mcp`
   - Header name: `Authorization`
   - Header value: `PULSE_VERITY_AUTHORIZATION` (the variable name)
3. Select that server on the starter's MCP Tools node and retain
   `get_index_price` with Tool Mode off. Hosted access requires your own key;
   the shipped starter intentionally uses the keyless local package.
4. Retain authentication, quota and verification failures as errors. Leave TLS
   verification enabled and do not automatically retry quota failures.

Do not forward unrelated incoming credentials to Verity. The Tool dropdown
does not restrict Agent Tool Mode: upstream `_get_tools()` discovers the
server's full toolkit. This starter deliberately executes its selected read
tool directly instead. Never include real credentials in a shared export.

## Keyless sample

For a connection-only configuration, register the server using the JSON
configuration in [stdio-sample.json](stdio-sample.json). This runs the pinned
public package and supports sample BTC, ETH and SOL observations without a key.
It downloads the package if it is absent. No Docker build is required by this
example; hosted HTTP is preferable if local processes are unavailable.

## Validation and provenance

The export carries unchanged upstream Core component code, as native Langflow
exports do. Chat Input/Output come from the upstream v1.12.5 Simple Agent export;
MCP Tools comes from that release's `MCPToolsComponent`. Exact source URLs and
SHA-256 values are recorded in [upstream.json](upstream.json), with the upstream
[MIT license](LICENSE.langflow). No custom price backend or new component is
introduced. The flow has no persistent flow ID, so importing it does not request
an overwrite of an existing flow.

Run the lightweight structural checks without dependencies:

```sh
python integrations/langflow/validate.py
```

The separate CI runtime gate uses the actual Langflow import model and graph
loader, then the real MCP component with synthetic success/error responses:

```sh
python -m pip install 'langflow==1.12.5'
python integrations/langflow/validate_runtime.py
```

Run the dependency installation in CI, not as a local production build. The
runtime script blocks outbound sockets and subprocesses. It starts no server,
does not invoke a model, and does not call the live Pulse service. Structural
checks alone do not establish runtime import; a successful runtime gate still
does not establish rendered UI behavior or live connectivity.

No gallery acceptance or screenshot is claimed. Langflow's upstream template
contribution requires a real screenshot and maintainer review; those are
separate from distributing this importable file.

References: [MCP client setup](https://docs.langflow.org/mcp-client) ·
[Starter template contribution process](https://docs.langflow.org/contributing-templates).
