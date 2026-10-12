# Monitor signed crypto price quality with MCP, Data Tables and Slack

## Who this is for
Operations teams maintaining a crypto dashboard or integration who need to distinguish an authentic price record from data that meets their own freshness and quality requirements.

## What it does
Every ten minutes, the workflow reads one symbol from the Pulse Verity Index through MCP, preserves the signed record and verifies it. It then evaluates a separate consumer policy for observation age, future timestamps, grade, confidence, dispersion and source count.

Each check writes a compact decision audit to n8n Data Tables. Persistent state suppresses repeated unchanged notifications. Slack receives initial failures, changed failure reasons or policies, and recovery. An initial healthy check establishes a quiet baseline. Timeouts, unavailable responses and invalid verification produce an UNAVAILABLE outcome instead of a fabricated price.

## Setup
Import while inactive. Select a Verity Bearer Auth credential in both MCP nodes. Create the two Data Tables with the exact schemas shown in the canvas notes. Select a Slack OAuth credential and channel. Review the symbol and illustrative consumer thresholds, test manually, then activate a cadence that fits your account limits. No AI model or community node is required.

## Important distinctions
Signatures establish record integrity, not price correctness. The hosted verifier is trusted over HTTPS. The example policy does not disclose Verity's proprietary engine or make data suitable for settlement. This is an operations monitor, not a trading or checkout workflow.

Audit rows grow over time; configure retention and project access. Run one execution at a time. Slack delivery and state persistence are not atomic, so an interrupted delivery can duplicate a later notification. Workflow-level automatic retries are disabled. Saved execution payloads are disabled; instance logs still follow hosting policy. n8n hosting costs and Verity account limits apply.
