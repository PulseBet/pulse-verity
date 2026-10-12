# Packaging addendum — 2026-10-11

Base commit: `a2921897f220a25e3733b9bddf6bcfe79a0f6171` plus the reviewed integration candidate.

The Dify README received a copy-only clarification after the final security
report: it now names the MIT license instead of saying the plugin is freely
distributed. The implementation, manifest, credentials, dependencies and tests
are unchanged. This does not replace or expand the security review.

The official CLI repackaged the candidate; archive README and unchanged adapter
were checked against source. Current archive SHA-256:
`e4d0c8a16f8b5c824805aadc404708ce47c9c222b3130dbb03d3179cc756155f`.
The earlier report's archive hash identifies the artifact before this copy edit.
Neither artifact has been installed into an authenticated Dify workspace.
