# Security — Pulse Verity Index dependency follow-up — 2026-10-11

| | |
|---|---|
| Critic | critic-security |
| Date measured | 2026-10-11 20:16 PDT |
| Surface | `package.json`, `package-lock.json`; affected dependency reachability from the public package executable |
| Build tag | `pulse-verity` 1.3.1 source candidate; no version bump or publication |
| Commit | `e057014da603700859493c4b3eb488a4c8da7ca8` plus the two dependency-file changes fingerprinted below |
| Measured against | Exact local diff, executable source and upstream maintainers' advisories |
| Verdict | CLEAN for the dependency patch; no reachable exploit from either advisory identified in this stdio executable |

**Read the date.** This supplements the earlier integration reports. It assesses the patched source candidate; it does not describe deployed backend dependencies or prove an npm release.

## Upstream advisories and project reachability

**CRITICAL upstream · dependency hygiene here** — `package-lock.json:881` locks `proxy-addr` at 2.0.8 instead of 2.0.7. The SDK depends on Express, which brings this package. The advisory concerns incorrect trust-subnet matching for particular IPv4-mapped IPv6 configurations: an unauthenticated requester can supply a forged forwarded address that bypasses IP-based controls. Version 2.0.8 is the listed fix. [Maintainer advisory GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h).

Reachability: `src/index.ts:4` imports stdio transport and `src/index.ts:596` connects the executable through it. This entrypoint creates no HTTP listener, Express app, proxy trust configuration or IP-based authorization. The affected network-proxy path therefore is not reached by this executable. No production incident is established by the audit match.

**HIGH upstream · dependency hygiene here** — `package.json:59` raises the SDK minimum from `^1.6.1` to **`^1.32.1`**; `package-lock.json:38` changes the resolved version from 1.30.0 to **1.32.1**. The advisory affects the SDK's HTTP OAuth client when a remote MCP server can nominate an authorization server and receive previously held OAuth credentials. The first patched 1.x version is 1.31.0. The maintainer explicitly excludes SDK-built MCP servers and stdio clients. [Maintainer advisory GHSA-6qxp-vccf-f47h](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h).

Reachability: this package is the stdio MCP server, not an OAuth HTTP client. No OAuth client, auth provider or token-exchange helper is used in its source. Its API access at `src/index.ts:303` uses fixed service paths, its developer credential and fetch with redirects rejected at `src/index.ts:333`. The advisory's credential-exchange path is absent. No credential disclosure or required incident response is established by these observations.

## Exact change and evidence

Only three lock entries differ: the root SDK requirement, the SDK package, and `proxy-addr`. Both upgraded package entries retain the same dependency declarations; the remaining change is proxy package funding metadata. Registry destinations remain npm, integrity values are updated, and no scripts, application code or additional dependency nodes are introduced. `git diff --check` passed. The builder reports a completed audit result of zero vulnerabilities across 98 packages after the update; the critic did not duplicate that audit or run package tests. Exact-candidate CI remains the builder's release gate.

## Limits

This is source and dependency-resolution review, not a full review of SDK changes, an exploit test or a production-backend audit. No installation, production traffic, token access, build, npm publication or deployment was performed by the critic. The lockfile establishes the reviewed checkout's resolution; another consumer's existing lockfile or already-published 1.3.1 install is not changed by this candidate. No conclusion about other clients' OAuth handling or hosted service proxy configuration follows from this stdio assessment.

SHA-256 of reviewed candidate files:

```text
e277ee997cad786012bd665879918a1ca9c9eccf61536813e2fd4b50721b0169  package.json
5e0cc654699ef73d1be0a79a66f350aa8c4a8a1d49e983c9ca0b1afdb20b0917  package-lock.json
```
