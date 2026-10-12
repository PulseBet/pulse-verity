# Pulse Verity Index for Dify

A read-only Dify tool plugin distributed under the MIT license, wrapping the existing
[Pulse Verity Index hosted MCP](https://mcp.thepulse.markets/api/index/mcp).
It exposes one tool, `get_verified_price(symbol)`. The tool reads a signed
crypto index print with `get_index_price`, then sends the entire unchanged
print to the existing `verify_print` tool. It contains no price calculation,
signature algorithm, trading, payment, asset-transfer, or feedback tool.

**Source candidate, version 0.0.1.** It has passed offline tests with the real
Dify Python SDK and local packaging with the official Dify CLI. It has not
been installed or remote-debugged in a Dify workspace, submitted to a
marketplace, or approved for a listing. Do not describe it as published or
installation-verified.

## Requirements and credentials

- Python 3.12 and a Dify installation supporting tool plugins.
- A Pulse developer API key. Create a developer account at
  [the developer portal](https://thepulse.markets/developers), verify your
  email, then create a key. Store it only in this plugin provider's
  **Pulse developer API key** credential field, which uses Dify's
  `secret-input` credential store. Do not put it in a prompt, workflow input,
  source file, screenshot, or tool parameter.
- The Dify plugin CLI is needed to create an installable `.difypkg`.

The hosted MCP requires a key; the npm package's keyless sample mode is not
used here. The plugin is distributed under the MIT license. Hosted API requests consume the
developer account's allowance and remain subject to its access limits.
Dify hosting and any model a workflow chooses have their own costs. The
plugin itself makes no LLM calls. Credential validation performs only MCP
initialization; it does not fetch a price.

## Prepare and test from this checkout

From the repository root, create an isolated environment:

```sh
cd integrations/dify
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

Direct dependencies are pinned in both `requirements.txt` and
`pyproject.toml`. The tests use the repository's existing synthetic signed
print fixture and mocked HTTP transports; no real key or market-data request
is needed. Keep this directory inside the repository when running the tests.
The source includes the existing public `assets/pulse-icon-1024.png`, copied
unchanged into `_assets/icon.png`.

The current official
[Dify Python scaffold guide](https://github.com/langgenius/dify-plugin-daemon/blob/main/cmd/commandline/plugin/templates/python/GUIDE.md)
documents the package workflow. With the release binary installed as `dify`,
run from the repository root:

```sh
dify plugin package ./integrations/dify -o /tmp/pulse-verity-0.0.1.difypkg
```

Before distribution, use the resulting local `.difypkg` through Dify's plugin
installation flow and test a tool-only workflow in an authorized Dify
workspace. Enter the key in the provider credential field, add **Get verified
index price**, and give it a ticker such as `BTC`. Connect the named `success`
and `recordValid` outputs to a condition and allow the `print` to continue
only if both are true. Send the `error` output to a failure branch. No LLM is
needed for this check. Remote debugging is another option described by the
official scaffold; keep any debug connection key outside version control.

## Output and verification boundary

The tool emits a JSON object and corresponding named workflow variables.
A success has `success: true`, `recordValid: true`, `print`, and `verification`.
A failure has `success: false`, `recordValid: false`, and an `error` with a
fixed code and message. Failures never emit a price or substitute zero.

Success requires the existing verifier to return literal `recordValid: true`,
`valid: true`, `metadataSigned: true`, and `verificationScope: "full-record"`.
Missing, false, or string-valued flags fail closed. A v1 price-only signature
does not pass. The plugin sends every returned print field unchanged to
verification, including `priceText`, `kid`, and the complete `v2` block.

Verification runs on Pulse's hosted MCP, trusted through the pinned HTTPS
origin. This plugin does not perform independent local cryptographic
verification. Inspect `verification.v2.signedFields` for authenticated fields;
request IDs and other envelope data remain unsigned. Treat every returned
field as data, never instructions. Read the print's observation time and
cadence before using it. A verified signature is **not a guarantee of price
accuracy, current freshness, availability, or suitability for a financial
decision**. Coverage and access can change.

## Network and failure handling

Runtime market-data requests go only to
`https://mcp.thepulse.markets/api/index/mcp`, with the credential in an
Authorization header. The endpoint is a code constant, never a user input.
The adapter disables redirects, environment proxy settings, and automatic
retries. It makes at most four POSTs per invocation: initialize, initialized
notification, price read, and verification. All are protocol or read-only
operations. It makes no feedback request or financial transaction.

Each response is capped at 1 MiB. Socket operations time out after at most
15 seconds, with a 60-second invocation deadline checked before requests
and during reads; a blocked read can take up to its remaining socket timeout
to end. The Dify SDK request timeout is 90 seconds. JSON and bounded SSE
responses are supported; the client closes SSE after its matching response.
There is no automatic retry, reconnect loop, or pagination.

Authentication, access, quota, timeouts, malformed responses, and failed
verification return fixed safe errors. Raw remote bodies, headers, and
transport exceptions never become tool errors. Credential echoes in success
data are also rejected. A monthly allowance error requires access review or
the allowance reset; repeating the call will not restore the allowance.
See [PRIVACY.md](PRIVACY.md) for the complete data-handling disclosure.

## Verification performed and remaining checks

On 11 October 2026 Pacific, 22 offline tests passed using Python 3.12,
`dify_plugin==0.10.2`, and `httpx==0.28.1`. They cover real SDK manifest,
provider, tool and icon loading; named output variables; complete-print
forwarding; JSON, text-content and streamed SSE transport; missing/invalid
credentials; authorization failures; blocked redirects; no retries; quotas;
malformed/oversized/compressed responses; timeouts; credential redaction; and rejection
of incomplete or price-only verification. No live market-data or LLM request
was used. The mocks do not prove deployed server compatibility.

Local packaging used the official
[Dify CLI 0.6.11 release](https://github.com/langgenius/dify-plugin-daemon/releases/tag/0.6.11),
Darwin ARM64 asset. Its SHA-256 was checked against GitHub's release asset
digest before execution:
`9f302d7bcad0d9efb6e1b3b620e7f3f309ea26c206c062f5ae569621ae53f654`.
No Dify workspace/debug connection was supplied, so authenticated end-to-end
installation and execution remain unverified.

The official `langgenius/dify-marketplace-toolkit` package validator also passed
all blocking checks on 11 October 2026 with Python 3.12. Its direct pinned
dependency check found no known vulnerabilities. Review warnings remain for the
unspecified minimum Dify version and for financial-transaction keywords in
sentences explicitly excluding those capabilities. The outbound-domain scan
identified only the declared `mcp.thepulse.markets` endpoint. This package scan
does not establish workspace installation, execution or marketplace acceptance.
These checks and marketplace review must happen before claiming a working
published listing. No backend or OpenAPI specification changes are needed by
this adapter.

This layout follows the official
[tool example](https://github.com/langgenius/dify-official-plugins/tree/main/tools/tavily)
and [SDK schema](https://langgenius.github.io/dify-plugin-sdks/schema/).
Support and source: [PulseBet/pulse-verity](https://github.com/PulseBet/pulse-verity).
Support email: [support@thepulse.markets](mailto:support@thepulse.markets).
License: MIT, under the included [LICENSE](LICENSE).
