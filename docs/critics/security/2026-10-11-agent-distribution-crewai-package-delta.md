# Security — CrewAI package and runtime validator delta — 2026-10-11

| | |
|---|---|
| Critic | critic-security |
| Date measured | 2026-10-11 22:49 PDT |
| Surface | CrewAI package metadata, console entrypoint and package check; integration CI additions; Langflow parameter-binding validator correction; no viewport applies |
| Build tag | `pulse-verity` 1.3.1 integration examples; CrewAI application package 0.0.1 candidate |
| Commit | Base `d068d828026d62e731909f126fac9f8bc351f146` plus the uncommitted files fingerprinted below |
| Measured against | Static working-tree delta and Python syntax parsing |
| Verdict | CLEAN for introduced security defects in this bounded delta review |

**Read the date.** This supplements the earlier Flow/export review and does not rewrite it. The fingerprints identify the exact uncommitted candidate reviewed.

The new setuptools metadata packages only the three existing CrewAI/shared modules and derives dependencies from the existing pinned requirements. Both console commands enter the same CLI, preserving its ticker validation, telemetry controls, error handling and read/verify adapter. The entrypoint adds no transport, tool, credential or subprocess behavior. The installed-package check uses isolated Python, asserts installed-module and entrypoint identity, mocks the Flow, and checks successful output plus a nonzero error exit.

The CI addition installs this local package without runtime dependency resolution into its existing disposable CrewAI environment, with a 90-second limit. Its isolated package check has a 30-second limit; the existing outer job cap, read-only permissions, checkout credential removal and absence of application-secret references remain. The pinned setuptools build backend may still be downloaded by pip's isolated build; `--no-deps` does not make that installation offline.

The Langflow correction binds parameters extracted from the imported vertex at the framework's execution boundary. It first checks the selected read tool, exported server configuration and Chat Input edge identity, replaces only the edge value with a synthetic Message, and retains the selected-output and real-component success/error checks. Existing outbound I/O guards remain. Three changed Python files parsed successfully without imports or execution. No actionable security defect was identified in this delta.

## Not covered

No installation, package build, actual console execution, real SDK test, live request, scanner, server, credential inspection or deployment verification was performed by this review. The CI checks were read, not rerun. Package resolution, upstream advisories, installed Langflow semantics, full graph execution and live authentication remain outside this narrow review. The broader limits of the earlier integration reports still apply; CLEAN is not a dependency or whole-product clearance.

## Candidate fingerprints

```text
0e5079c4b7badf29ae944785f7d24fe3f02bbd1f55451be015da53828f30492c  integrations/python/pyproject.toml
49b4a816dbb3b4df9398a01ecd838b8f9605825fb398c77ebb6aba1fd4b7ab51  integrations/python/crewai_flow.py
c49c3a05296c1a469c733f193f3abefc1cda10fb61d5e4a17deb68f9b60b33db  integrations/python/runtime_tests/validate_crewai_package.py
a2c5fe46ea54c0c8c6012a2b8b3417516b951c7a92b377970450044af17db015  .github/workflows/integrations.yml
36f36f47e62e1e8ce719bf6935fb6ef3dce16b745bc89682cd2e9e64b68fe9ce  integrations/langflow/validate_runtime.py
```
