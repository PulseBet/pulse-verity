# Security — integration Flow and native export delta — 2026-10-11

| | |
|---|---|
| Critic | critic-security |
| Date measured | 2026-10-11 22:43 PDT |
| Surface | CrewAI Flow, Langflow native export and validation, integration CI, Dify metadata; no viewport applies |
| Build tag | `pulse-verity` 1.3.1 integration examples; Dify 0.0.1 candidate |
| Commit | `d068d828026d62e731909f126fac9f8bc351f146`, compared with `8e98e80` |
| Measured against | Static committed source and dependency-free Langflow export checks |
| Verdict | CLEAN for introduced security defects in this bounded delta review |

**Read the date.** This describes the named commit only. It supplements the earlier integration and dependency reports without changing their findings or coverage.

The CrewAI Flow validates its ticker before the adapter call, clears its result at the start of each run, and populates result state only after the existing read/verify routine succeeds. The existing context-managed adapter remains responsible for teardown on both success and failure. Arbitrary SDK exceptions are replaced with a fixed message before listener logging; the allowed `ExampleError` paths in the shared reader use fixed messages. Added runtime tests explicitly check adapter thread/loop shutdown, rejected verification, missing tools, tool errors and empty result state after failure.

The Langflow export selects the single `get_index_price` execution output with Tool Mode disabled, empty headers, an explicit empty Verity key, TLS verification enabled, disabled chat storage and a 30-second tool timeout. Its upstream component executes the selected tool and raises on MCP `isError`; the documentation correctly distinguishes this unverified sample from full-record verification and notes that Agent Tool Mode would expose the discovered toolkit. The embedded source hashes match the committed provenance manifest. Seven dependency-free checks passed, including rejection of populated credentials, altered component code, write-tool selection, Tool Mode, disabled TLS and disconnected edges.

The CI additions retain pull-request/manual triggers, read-only repository permissions, immutable action references and checkout without persisted credentials. No application-secret reference or privileged pull-request trigger is added. Framework jobs have a 15-minute outer cap and bounded install/test commands; Langflow has a 10-minute outer cap and bounded install/test commands. The synthetic runtime guards and telemetry settings are consistent with their offline purpose. Dify adds public support/source metadata and its declared MCP domain, with no credential or new adapter behavior.

## Not covered

No runtime SDK installation, production call, active scanner, server, credential access, browser import, authenticated workspace test or deployed-artifact check was performed. This reviewer ran only the seven dependency-free export checks; the new real-framework tests and Langflow runtime script were reviewed statically, not rerun. Provenance hashes were checked against the committed manifest, not independently downloaded upstream sources. Actual subprocess environment inheritance and platform-level MCP server overrides remain properties of the installed Langflow runtime; the empty exported key is configuration evidence, not a measured process-environment guarantee. No complete dependency audit, backend perimeter, frontend bundle, settlement, wallet or other money path was included in this requested delta review. CLEAN does not assert marketplace acceptance, live reachability or whole-product security.
