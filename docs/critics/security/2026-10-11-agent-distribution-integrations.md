# Security — Pulse Verity Index integration candidates — 2026-10-11

| | |
|---|---|
| Critic | critic-security |
| Date measured | 2026-10-11 20:12 PDT |
| Surface | Added `integrations/`, root README integration link, and `.github/workflows/integrations.yml`; no viewport applies |
| Build tag | `pulse-verity` 1.3.1 integration examples; Dify plugin candidate 0.0.1 |
| Commit | Base `a2921897f220a25e3733b9bddf6bcfe79a0f6171` plus the uncommitted candidate files fingerprinted below |
| Measured against | Static source, current hosted adapter source supplied for comparison, and offline synthetic tests |
| Verdict | CLEAN for introduced security defects in this bounded review |

**Read the date.** This describes the candidate files below, not later edits, deployed services, published packages or marketplace acceptance.

## Checked

The Python examples, n8n workflow and Dify adapter preserve the signed print as flat `verify_print` arguments and require literal `recordValid`, `valid` and `metadataSigned` booleans plus the full-record scope. Price-only verification, truthy strings and unavailable prices fail closed. The n8n gate also binds the response to the exact price, key and complete signed field set. The shared Python summary exposes only the named signed quality subset; Dify and n8n identify extra print metadata as unsigned. The hosted source confirms the current verifier accepts these fields and uses a stateless Streamable HTTP transport; Dify's lack of session persistence therefore matches this supplied adapter. None of these checks proves freshness or economic accuracy, and the documentation says so.

Credentials are taken from environment or platform credential facilities, not tool arguments, workflow exports or URLs. No real credential was identified in the reviewed additions. The direct Dify transport pins HTTPS, disables redirects and environment proxies, bounds responses and request durations, refuses credential echoes, and converts failures to fixed messages. Framework and low-code clients retain their SDK transport behavior; this review does not claim they disable redirects. The examples allow only the read/verify tools, do not call a model, and do not introduce wallet, payment or feedback operations. The Flowise/Langflow guides correctly state that an agent instruction alone cannot enforce verification.

Direct new Python dependencies and the stdio npm package are version-pinned; framework environments are deliberately separate. The CI workflow uses pull-request/manual triggers, read-only repository permission, immutable action references, checkout without persisted credentials, cancellation and a ten-minute cap. It does not reference application secrets or use `pull_request_target`.

## Offline evidence

- `node --test integrations/n8n/validate.mjs`: **33 passed**; executes the exported code and independently checks the existing synthetic signed fixture.
- `python -B -m unittest discover -s integrations/python/tests -v`: **25 passed**; result gates, framework call order/configuration and cleanup. Frameworks are doubles in this suite.
- `python -B -m unittest discover -s tests -v` from `integrations/dify`: **21 passed** using the existing isolated Python 3.12 environment and real Dify SDK; HTTP is mocked. Includes malformed responses, redirects, quota failures, credential echoes and SDK registration.

## Not covered

No live authenticated MCP request, production scan, credential access, installation, production build, persistent server or marketplace submission was performed. No claim is made that the Python frameworks resolve together or were executed with their installed SDKs: only selected published-source interfaces and the offline doubles were reviewed. n8n, Flowise, Langflow and Dify workspace imports and runtime policy remain unverified by this critic; a workspace operator with their own developer credential must perform those checks. Dify package creation was being performed separately and is not evidence supplied by this review. No complete transitive dependency resolution, advisory audit or hash-locked dependency assessment was performed, so CLEAN is not a dependency-vulnerability clearance. The backend dependency tree, frontend built bundle, production signing-key custody, authorization perimeter and money routes are outside this integration-only scope.

## Candidate fingerprints

SHA-256, allowing later sessions to distinguish the reviewed implementation from subsequent edits:

```text
8238c6ae4d3a8a81f633591739522737e0114ca4469cf1d4b9b6e848601a429f  README.md
114457d8f69adf7b4745bfbc2821a643eb70a1441c74520de41d74ef6312f8ea  .github/workflows/integrations.yml
768ff132fd8d3ce779876ec50508549dfe78db3ea53dc1120a920ef034da80d9  integrations/python/common.py
1dd7511efb60662b49821023cf045df68f42981bdc614b03ac3c0c72897e9b91  integrations/python/langchain_graph.py
15c78701a71999d83c866d2d296f45f3689f8bc55375b835d21a3cd669031302  integrations/python/google_adk.py
61dc537223fe828da1bc0a3effccc494b8063defce2be3c33bde1547e3f33568  integrations/python/crewai_example.py
f3b37910fbc399c7d7e8df470b2a19f3da8b739df5a48309cdfe66f69aabee49  integrations/dify/lib/verity_mcp.py
0290fdaa1e707e053d286d537fc26b8b91d0f096736131bd0cfa6ad800c6250a  integrations/dify/tools/get_verified_price.py
1d48061801eb5a71a9ac2ab61de4eaceaa3eefdd1c1ba15f4196fff5a9d4fa6c  integrations/dify/provider/pulse_verity.py
1a8a360ea9808b5ca2a579165a1742b922b7d472cdd5c10e49bfe43957dd76de  integrations/n8n/pulse-verity-signed-price.json
```
