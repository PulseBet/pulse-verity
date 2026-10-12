# Data handling: Pulse Verity Index for Dify

Candidate disclosure dated 11 October 2026 Pacific. This describes the code in
this directory; it does not claim a Dify Marketplace approval or a live
installation.

## What the plugin sends

The runtime sends HTTPS POST requests only to
`https://mcp.thepulse.markets/api/index/mcp`. Requests contain MCP client and
protocol metadata, a random request identifier, the requested crypto ticker,
and, for verification, the complete signed print returned by Pulse. The Pulse
developer key is sent only to this pinned origin in an Authorization header.
It authenticates account access and the service meters applicable API usage.
Credential validation performs initialization with the same origin and key.

The plugin does not request names, email addresses, wallet information,
payments, project files, conversation transcripts, or full prompts. A ticker
is its only tool parameter. It makes no analytics, telemetry, model, feedback,
or advertising request. It cannot initiate a financial transaction. The
plugin has no configurable network destination and does not follow redirects.

## Storage and recipients

Dify manages the developer key through its provider credential store. The
plugin reads it for the current call and does not write credentials or tool
data to files or its own persistent storage. It emits no application logs.
It returns signed print data, verifier results, or fixed safe errors to Dify.
Credential echoes from the remote service are rejected before output.

Your Dify operator controls its credential storage, workflow history, logs,
retention and access policies. If you connect the output to a model or another
workflow node, that configuration determines the further recipients. This
plugin itself does not invoke a model. During remote debugging, the Dify SDK
communicates with the Dify debug service you configure; keep that debug key
private and use only an authorized environment.

Pulse receives the API requests, credential and ordinary network metadata
such as source IP. This adapter does not control Pulse service retention or
Dify retention. See [Pulse's privacy policy](https://thepulse.markets/privacy)
and, for Dify Cloud, [Dify's privacy policy](https://dify.ai/legal/privacy-policy).
For self-hosted Dify, consult your operator's policy. Do not infer a data
deletion or retention guarantee from the absence of local plugin storage.

Package installation downloads the declared Python dependencies through your
configured package index, normally PyPI. This is installation traffic rather
than a market-data request. The source and official public icon are included
in the plugin package; no runtime image download is required.

## Control and support

Remove the provider credential or uninstall the plugin in Dify to stop future
calls. Revoke the developer key in the
[Pulse developer portal](https://thepulse.markets/developers) if needed.
These actions do not erase existing service or workflow records. For code
issues use the [source repository](https://github.com/PulseBet/pulse-verity).
Never include a key or private workflow data in a public issue.
