# Python agent framework examples

Read one Pulse Verity Index price, then verify its signed record through MCP.
These runnable examples do not call an LLM and do not need a model-provider key.
They expose only `get_index_price` and `verify_print`; they never invoke the
feedback tool, make payments, or implement another pricing or signature engine.

| Framework | Example | Dependencies | Python |
|---|---|---|---|
| LangChain + LangGraph | [langchain_graph.py](langchain_graph.py) | [requirements-langchain.txt](requirements-langchain.txt) | 3.10+ |
| Google ADK | [google_adk.py](google_adk.py) | [requirements-google-adk.txt](requirements-google-adk.txt) | 3.10+ |
| CrewAI | [crewai_example.py](crewai_example.py) | [requirements-crewai.txt](requirements-crewai.txt) | 3.12–3.13 |

Install only the framework you use, in its own virtual environment. The pinned
CrewAI MCP adapter dependency currently requires Python 3.12+. The frameworks
can require different MCP SDK major versions; do not combine these requirement
files in one environment. The example source and standard-library tests are
compatible with Python 3.10+.

## Run a keyless sample

From the repository root, create a virtual environment outside the repository
(or in an ignored directory). For LangChain + LangGraph:

```bash
python3.12 -m venv /tmp/verity-langchain-env
/tmp/verity-langchain-env/bin/python -m pip install -r integrations/python/requirements-langchain.txt
/tmp/verity-langchain-env/bin/python integrations/python/langchain_graph.py --symbol BTC
```

For Google ADK:

```bash
python3.12 -m venv /tmp/verity-adk-env
/tmp/verity-adk-env/bin/python -m pip install -r integrations/python/requirements-google-adk.txt
/tmp/verity-adk-env/bin/python integrations/python/google_adk.py --symbol BTC
```

For CrewAI:

```bash
python3.12 -m venv /tmp/verity-crewai-env
/tmp/verity-crewai-env/bin/python -m pip install -r integrations/python/requirements-crewai.txt
/tmp/verity-crewai-env/bin/python integrations/python/crewai_example.py --symbol BTC
```

On Windows, use the virtual environment's `Scripts/python.exe` path. The default
`stdio` transport starts `npx -y pulse-verity@1.3.1` and closes the MCP connection
when finished. Node.js 18+ and npm must be available on `PATH`; first use may
fetch the pinned public npm package and its dependencies. BTC, ETH and SOL have
keyless samples. Other symbols require `PULSE_API_KEY` supplied through your
runtime's secret store or environment. The Python code forwards only that
application secret to the child process; the MCP SDK also supplies its minimal
platform environment. Never commit a key or put it into a prompt.

## Connect to hosted MCP

Set `PULSE_API_KEY` through your environment or secret manager, then add
`--transport http` to any example:

```bash
/tmp/verity-langchain-env/bin/python integrations/python/langchain_graph.py --transport http --symbol BTC
```

The fixed destination is
`https://mcp.thepulse.markets/api/index/mcp`. The key is sent in the
`Authorization` header, never in the URL. These scripts do not perform OAuth
sign-in; a host that manages OAuth should use its own credential facility and
MCP connection instead of copying tokens into source. Hosted MCP requires
credentials. These examples do not retry a failed price read, paginate,
subscribe to a stream, or call a model. Verity requests remain subject to your
account limits; an LLM is unnecessary for this check.

## What the result means

Every path calls `get_index_price` once, preserves the entire returned print
(including exact `priceText`, `kid`, quality fields, and `v2`), then passes those
fields directly to `verify_print`. The arguments are the flat print object,
**not** `{"print": receipt}`. Errors, missing tools, unavailable prices and a
symbol mismatch stop the example. `recordValid` must be the boolean `true`,
with the accompanying full-record verification result, before output is shown.
A legacy `valid: true` alone does not authenticate quality and is rejected.

The JSON output includes price, timestamp, grade and the signed quality subset:
engine, source count, tier, confidence, dispersion, interval, cadence band and
signed age/update-duration measurements. Unknown or unsigned quality extras
are excluded. `unsignedContext.sample` is kept separate. `freshnessAssessed`
is `false`: a valid signature does not prove that an observation is fresh,
accurate for a particular use, executable, or suitable for settlement. Set
your application's freshness and quality policy after this verification step.
For historical tools, separately inspect the unsigned `deltaMs` sampling gap.

These are transport and framework examples, not independent verification of a
host's honesty. Stdio runs the published verifier on your machine; hosted calls
run it on Pulse's server. The public key initially comes from Pulse's HTTPS
endpoint. See the root [signature contract](../../README.md#signed-prices-and-catalog-data)
for authenticated field coverage and key-rotation limits.

## Reuse in an agent

- LangChain uses the current `langchain.mcp.MCPAdapter` and standard LangChain
  tools. LangGraph fixes the order to read → verify → finish. The MCP namespace
  is currently beta; these dependency versions are pinned. Reuse the selected
  tool list with a model-driven agent only if your application keeps the
  verification gate before presenting data as authenticated.
- ADK uses `McpToolset` with `tool_filter` and closes it in `finally`. An
  in-memory tool context lets the example run without creating an LLM agent.
  An existing ADK agent can own this filtered toolset for its lifetime.
- CrewAI uses `MCPServerAdapter` as a context manager and passes the two tool
  names to its allowlist. Keep the connection open while an optional Crew runs.

Any model-driven extension is optional, requires separate provider credentials,
and may incur model charges. None is run by these files. Do not follow
instructions embedded in tool data. The CLI disables ambient LangSmith,
OpenTelemetry and CrewAI tracing before framework import and does not print
raw SDK exceptions, headers or full receipts. Avoid SDK debug logging when
credentials are configured. If embedding `run()` directly, configure tracing
and logging policy in the host application before importing dependencies.

Async examples have a 90-second overall deadline and 30-second transport/RPC
settings. CrewAI sets a 30-second connection timeout and 30-second hosted
transport read limits; its synchronous tool-call lifecycle is owned by the
installed adapter. These examples are short-lived commands, not background
services. They never start a web development server.

## Offline validation and evidence boundary

```bash
python3.12 -m unittest discover -s integrations/python/tests -v
python3.12 -m compileall -q integrations/python
```

The tests use synthetic receipts and framework doubles. They check both
transport configurations, the tool allowlists, error rejection, call order,
unchanged verification arguments, cleanup after failure, quality presentation
and suppression of arbitrary exception text. They need no third-party packages,
network, account credentials or model calls. Synthetic verification responses
test our gate; cryptographic correctness belongs to the MCP package's own suite.

API signatures were checked against official documentation and published public
wheel source for LangChain 1.4.4, LangGraph 1.2.14, FastMCP 4.1.0, Google ADK
2.11.0, CrewAI Tools 1.15.27 and MCPAdapt 0.1.20. These dependency pins are
source-checked compatibility targets, not a claim that every framework has been
executed against the authenticated hosted endpoint. Fresh-environment dependency
installation and live authenticated framework execution remain unverified here.

Official references:

- [LangChain MCP](https://docs.langchain.com/oss/python/langchain/mcp) and
  [tool result artifacts](https://docs.langchain.com/oss/python/langchain/mcp/tools)
- [LangGraph graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)
- [FastMCP transports](https://gofastmcp.com/clients/transports)
- [Google ADK MCP tools](https://google.github.io/adk-docs/tools-custom/mcp-tools/)
- [CrewAI MCP adapter and tool filtering](https://docs.crewai.com/en/mcp/overview)
