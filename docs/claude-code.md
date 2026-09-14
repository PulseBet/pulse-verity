# Pulse Verity for Claude Code and Cowork

This repository contains a Claude plugin: a read-only MCP connection plus a
guided reference-price and receipt-verification skill. It is separate from the
Claude Desktop `.mcpb` extension. Public-directory inclusion requires Anthropic's
review; this repository alone does not establish a marketplace listing.

## Try locally in Claude Code

Review the public source first. With Git, Node.js 18+, npm and Claude Code already
installed, use a new directory:

```sh
git clone https://github.com/PulseBet/pulse-verity.git
cd pulse-verity
claude plugin validate . --strict
claude --plugin-dir .
```

This loads the plugin for that session, not as a permanent marketplace install.
Do not separately approve the repository's project-scoped MCP configuration if
the plugin-provided server is already enabled; use one connection. In Claude,
check `/mcp` for the plugin's `pulse-verity` server and its tools. Review the host's
trust prompts before allowing it to run. Invoke the skill with
`/pulse-verity:pulse-verity-price-check` or ask for a Pulse Verity price check.

The server runs the pinned npm package `pulse-verity@1.2.6`. npm may download the
package and its dependencies. No API key is needed for limited BTC, ETH and SOL
price samples or receipt verification. The sample is not a paid entitlement.

## Your own developer access

Catalogue, batch and recorded-print requests require an account/key with
appropriate access and remaining allowance. Obtain your own key from the
[developer portal](https://thepulse.markets/developers). Do not paste it into
Claude chat or a repository file.

For Claude Code, supply `PULSE_API_KEY` privately in the environment that launches
the application, then restart Claude. The root `.mcp.json` uses the documented
`${PULSE_API_KEY:-}` expansion: the user's value when set, an empty string when
unset. It does not overwrite the user's key with a placeholder.

One option in macOS/Linux bash or zsh is to enter it invisibly into a temporary
subshell. These commands do not place the key's text in shell history:

```sh
(
  printf 'Pulse API key (input hidden): ' >&2
  IFS= read -r -s PULSE_API_KEY
  printf '\n' >&2
  export PULSE_API_KEY
  claude --plugin-dir .
)
```

The subshell exits when Claude exits. Do not print the variable. Use your
organization's approved secret-management method if one is provided. Access,
coverage and usage allowances depend on the account and current availability.

## Three example requests

1. **Keyless:** “Use Pulse Verity to read a BTC sample and verify its receipt.
   Show the observation timestamp and sample status. Explain what the signature
   does and does not authenticate.”
2. **Keyless:** “Read ETH and SOL individually using Pulse Verity. Verify each
   receipt without changing the signed fields. Report unavailable values rather
   than substituting zero.”
3. **With your own configured key:** “List one page of five Pulse Verity catalogue
   assets. Request a BTC/ETH batch, verify each successful receipt, then retrieve
   the recorded BTC print nearest the returned BTC timestamp. Report its timestamp
   and deltaMs; don't assume it matches the earlier read.”

No prompt requires a fixed expected price. Each result is an observation, and
availability can change. A valid signature authenticates canonical fields, not
economic accuracy, freshness, surrounding metadata or fitness for trading. The
historical tool does not execute financial settlement.

## Cowork and the public directory

The same plugin format is accepted for Cowork/Claude Code directory submissions.
After an approved directory listing becomes available, users can install it
through their host's plugin interface. This is not a claim that Pulse is listed
or Anthropic Verified.

Cowork's execution environment is separate from your Mac shell. Keyless operation
still needs Node/npm support in that runtime. Do not assume local environment
variables or local installed binaries are forwarded there. This package does not
provide a hosted OAuth connector or a Cowork-specific private-key settings UI.
If the host cannot run/configure it, use a supported local Claude Code setup;
do not put a key in the conversation to work around the limitation.

## Data access and troubleshooting

- At startup, npm retrieves the package from the configured registry. During tool
  calls the server sends bounded GET requests to `https://mcp.thepulse.markets`
  for prices, samples, catalogue, recorded prints and published verification keys.
  Keyed requests send the configured key only to that origin; sample/public-key
  requests do not send it. Receipt verification runs locally after key retrieval.
- This package has no trading, transfer, filesystem-reading, browser-reading or
  conversation-history tools, no hooks and no background routines. It does not
  upload project contents. See the [privacy policy](https://thepulse.markets/developers/privacy)
  and [service terms](https://thepulse.markets/developers/terms).
- If `npx` is unavailable, confirm Node/npm exists in the actual Claude runtime.
  If a plugin does not load, run `claude plugin validate . --strict`, restart and
  inspect `/mcp`. Confirm that the package version is available before retrying.
- Missing key: samples remain available, but wider requests need developer access.
  Refused key: check private configuration, without displaying the value.
- Quota: follow the returned limit guidance. Replacing a key does not reset an
  account allowance. Do not loop retries or change a paid plan automatically.
- Unavailable price or verification key: report the failure explicitly. A failed
  signature check is not, by itself, proof of alteration.

Report non-sensitive technical issues through
[GitHub issues](https://github.com/PulseBet/pulse-verity/issues). For private
support use support@thepulse.markets; do not send passwords or API keys.

## Validation

The dedicated Claude-plugin CI checks the manifest, configuration, skill and
published stdio package without making model calls. Its optional live smoke
reads one BTC sample and verifies its receipt. Passing that programmatic check
does not certify Cowork UI compatibility or marketplace approval.

Official format references:
[plugin submission](https://claude.com/docs/plugins/submit),
[plugin reference](https://code.claude.com/docs/en/plugins-reference), and
[MCP environment expansion](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson).
