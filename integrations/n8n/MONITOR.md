# Signed crypto-price quality monitor

`pulse-verity-quality-monitor.json` is an inactive, single-symbol operations monitor. It replaces a demonstration-only endpoint sequence with a scheduled decision audit and Slack failure/recovery notifications. The original manual example remains available separately.

## Setup

Use n8n 2.42.6 or a compatible release with MCP Client 1.1, Data Table 1.1, Slack 2.3, Code 2, Edit Fields 3.4, If 2.2 and Schedule Trigger 1.2. The export contains no credential references, keys, project/table IDs, Slack destinations, pinned data or personal records.

1. Import the JSON while inactive. Create a developer key at https://thepulse.markets/developers and select its **Bearer Auth** credential in both MCP Client nodes.
2. Create `verity_monitor_audit` in the current n8n project. String columns: `monitorKey`, `policyKey`, `symbol`, `observedAt`, `status`, `reason`, `priceText`, `recordAt`, `grade`, `evidenceJson`, `executionId`. Boolean: `recordValid`. Number: `ageSeconds`.
3. Create `verity_monitor_state`. All string columns: `monitorKey`, `policyKey`, `status`, `reason`, `observedAt`, `executionId`. Table names must be unique in the project. The three Data Table nodes use By Name; alternatively select the two tables explicitly.
4. Select a Slack OAuth credential and operations channel in **Notify operations**. Invite the credential's app to that channel. Use a test channel first.
5. Review **Monitor settings**: symbol, maximum observation age/future skew, allowed grades, minimum confidence/source count and maximum dispersion. The defaults are illustrative consumer policy, not the index's proprietary calculation thresholds or a settlement standard.
6. Execute the complete manual path, inspect the audit row and baseline state, then enable the schedule if its usage fits your account. Do not test manually while scheduled executions are active.

## Behavior

The hosted MCP service reads and verifies the exact signed print. Strict verification requires both signatures, the full covered field set, exact record matching and the expected signing key identifiers. The consumer policy is evaluated only after that gate passes. An authentic but old observation is **REJECTED**, not silently treated as fresh. Read/verification errors become **UNAVAILABLE** with no price; the raw provider response is not copied into storage or Slack.

Every observation is appended to the audit before notifications. The compact audit contains public quality fields and verification metadata; it is not a full signed-print archive or an independently replayable cryptographic receipt. `recordValid` is separate from policy acceptance. Hosted verification trusts the same service over HTTPS and does not establish price correctness.

A first healthy check establishes a quiet baseline. Initial faults, changed reasons/policies and recovery produce an operations message. Repeated unchanged states do not. State is saved after Slack succeeds or after a quiet baseline. A failed audit, state lookup, Slack call or state write stops execution. Configure n8n's execution-failure monitoring separately; this workflow cannot report through a broken Slack connection.

## Delivery, capacity and concurrency limits

No automatic node retries. An ambiguous Slack response or a crash after delivery but before state persistence can produce a duplicate on a later execution. Check the destination before manually retrying an uncertain run. This is best-effort state-change suppression, not exactly-once notification delivery.

Run one execution at a time for a given monitor. The ten-minute interval and two-minute timeout reduce normal overlap but do not implement a distributed lock. Configure instance concurrency and avoid overlapping manual runs. Duplicate state rows cause a bounded, explicit conflict. Do not use this template for trading, payments, checkout or settlement.

The default cadence runs 144 checks/day and at most two tool calls/check, plus MCP protocol traffic. API quota, data-table capacity, n8n hosting and Slack policies apply. Review your plan before activation. Audit storage grows each run: set your own retention policy and project access. The template never deletes rows or creates tables. Saved execution payloads are disabled; instance logging policies still apply.

## Validation

Run `node --test integrations/n8n/validate.mjs integrations/n8n/validate-monitor.mjs`. The offline harness executes the exact exported Code and expressions against a public signed fixture, independently checks fixture signatures using Node crypto, traverses success/error paths, and simulates Data Tables/Slack. It covers invalid config, tampering, partial verification, stale/future timestamps, missing quality metadata, policy thresholds, quiet repeated faults, recovery, duplicate state and dependency failure ordering.

Offline tests are not a live n8n execution. A separate CI import job checks the export with a pinned n8n CLI in a disposable runner. Neither test activates the monitor, posts to Slack or consumes a Verity key. A credentialed end-to-end run remains an installation check before activation.

## Public node contracts

Parameters were checked against the official n8n 2.42.6 sources: [Data Table](https://github.com/n8n-io/n8n/tree/n8n%402.42.6/packages/nodes-base/nodes/DataTable), [Slack](https://github.com/n8n-io/n8n/tree/n8n%402.42.6/packages/nodes-base/nodes/Slack/V2), [If](https://github.com/n8n-io/n8n/tree/n8n%402.42.6/packages/nodes-base/nodes/If/V2), and [Schedule Trigger](https://github.com/n8n-io/n8n/blob/n8n%402.42.6/packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts).
