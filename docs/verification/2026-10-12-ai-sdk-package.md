# AI SDK package verification — 12 October 2026 Pacific

Source: `7e91f58`. Package candidate: `ai-sdk-tool-pulse-verity@0.1.0`.
Builder verification, not independent review or marketplace acceptance.

GitHub Actions [38292800184](https://github.com/PulseBet/pulse-verity/actions/runs/38292800184)
passed type checking, all20 offline tests, JS/declaration compilation, the exact
seven-file artifact allowlist, and a clean-directory tarball installation that
fetched and fully verified a BTC sample. No model API key or paid LLM call.
An earlier candidate failed on a test result's unknown TypeScript type; the
assertion now narrows it before reading the property.

The npm production-dependency advisory audit returned zero advisories at this
check. This is not a guarantee against unknown vulnerabilities.

Security boundaries reviewed: the new public entrypoint uses the existing fixed
HTTPS MCP destination, refuses malformed/missing hosted credentials, has no
sample fallback, and requires explicit sample selection. Sample mode refuses a
supplied key and blanks the child process PULSE_API_KEY. No dependency install
lifecycle script runs in verification. Package publication consumes the verified
tarball in a separate manual/main-only environment job; npm credentials are
passed only to the publish step. No schedule or production service deployment.
Static guide uses no script, third-party asset, credential, form or analytics.

Limits: hosted execution is tested with a mocked transport, not a live account;
model orchestration uses a synthetic model. A valid signature does not establish
freshness or settlement suitability. SDK result size checks occur after decoding;
no claim of a network-level byte cap. Request cancellation has deadlines, while
transport cleanup relies on the SDK close behavior. Applications must set their
own user access controls, overall tool-call and spend limits. No package or
registry publication is established by this candidate run.
