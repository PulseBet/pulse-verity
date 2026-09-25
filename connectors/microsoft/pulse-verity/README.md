# Microsoft certification prep for Pulse Verity Index

This directory is the source package for onboarding the production Pulse Verity MCP server as a Microsoft custom connector and preparing a verified-publisher certification submission. It does **not** mean the connector is certified or listed.

## Verified production contract

| Item | Value |
|---|---|
| Streamable HTTP endpoint | `https://mcp.thepulse.markets/api/index/mcp` |
| Transport | MCP Streamable HTTP over `POST` |
| Authentication in this artifact | `Authorization: Bearer <developer key>` |
| Alternate live authentication | OAuth 2.1 dynamic registration and PKCE with discovery |
| Tool count | Five, all read-only |
| Public documentation | `https://thepulse.markets/developers` |
| Privacy | `https://thepulse.markets/developers/privacy` |
| Support | `support@thepulse.markets` |

The production endpoint, authentication challenge, discovery documents, and legal URLs were read without credentials on 2026-09-24 Pacific time. An unauthenticated initialize request returned `401` with a path-specific protected-resource challenge, which is the expected boundary.

## Files

- `apiDefinition.swagger.json` — OpenAPI 2.0 wrapper for the single production MCP endpoint.
- `apiProperties.json` — protected API-key connection parameter, brand color, and publisher metadata.
- `icon.png` — 200×200 nontransparent submission icon with the mark inside Microsoft's 70% content bound.
- `intro.md` — public documentation source for certification.
- `reviewer-evaluation.md` — credential-free manual-review and EVAL plan.
- `submission-checklist.md` — completed technical items and publisher-only gates.
- `validate.mjs` — offline structural, metadata, security, documentation, and icon checks.

## Why the artifact uses a developer key

Pulse Verity's hosted MCP server supports two independent bearer forms: a `pidx_…` developer key and an OAuth access token. Its OAuth flow uses dynamic client registration for a public PKCE client and deliberately has no fixed client secret. Microsoft's current `apiProperties.json` examples for generic OAuth require a fixed client identifier, while Microsoft's MCP onboarding wizard supports dynamic discovery directly.

This package therefore uses Microsoft's API-key connection type and asks for the exact Authorization header value, `Bearer <developer key>`. It does not invent an OAuth client identifier or commit a secret. Copilot Studio exposes a dynamic-discovery onboarding option, but compatibility with Verity's secretless public-client registration remains pending an end-to-end Microsoft connection test. This package does not claim Microsoft 365 DCR compatibility.

## Validate offline

From the repository root:

```bash
node connectors/microsoft/pulse-verity/validate.mjs
```

The script makes no network calls and requires no credentials. Microsoft's own Solution Checker, custom-connector Test page, package validator, and Partner Center validation remain required before submission.

## Current Microsoft references

- [Microsoft MCP server certification](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-server-certification)
- [Connect an existing MCP server](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [Prepare connector files for certification](https://learn.microsoft.com/en-us/connectors/custom-connectors/certification-submission)
- [Verified publisher certification process](https://learn.microsoft.com/en-us/connectors/custom-connectors/submit-for-certification)
- [Microsoft Power Platform Connectors repository](https://github.com/microsoft/PowerPlatformConnectors)

The local schema review used Microsoft repository commit `ba1998739a849fe44b9397bc758067ae56e887f7`, current on 2026-09-24 Pacific time.
