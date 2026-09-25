# Microsoft certification checklist

Statuses describe this repository package. They do not assert Partner Center approval or certification.

## Technical source package

- [x] Production Streamable HTTP endpoint is fixed at `https://mcp.thepulse.markets/api/index/mcp`.
- [x] OpenAPI version is 2.0 and the MCP operation declares `mcp-streamable-1.0`.
- [x] OpenAPI contains one runtime MCP endpoint and no invented REST actions.
- [x] Authentication maps to the live `Authorization: Bearer <developer key>` route.
- [x] No key, access token, password, OAuth client secret, or test credential is committed.
- [x] All documented tools are read-only and match the hosted server's five-tool contract.
- [x] Public docs distinguish signed receipt fields from unsigned metadata.
- [x] Public docs describe unavailable prices as unavailable rather than zero.
- [x] `intro.md`, reviewer cases, deployment instructions, support, privacy, and known limitations are present.
- [x] Icon is a 200×200 nontransparent PNG, uses a nonwhite brand color, and keeps the mark below 70% of the canvas.
- [x] Offline package validation passes with `node validate.mjs`.

## Publisher and environment gates

These steps require the publisher's Microsoft tenant or a commercial decision and cannot be represented as complete by source code.

- [ ] Partner Center seller account is active and business verification is complete.
- [ ] Publisher is enrolled in the Microsoft 365 and Copilot program.
- [ ] The Entra ID user used for submission has a valid email address.
- [ ] The publisher confirms ownership or control of `mcp.thepulse.markets`.
- [ ] A Power Platform environment with Dataverse and permission to create solution connectors is available.
- [ ] Publisher chooses the Microsoft Standard Contract or provides an approved EULA URL.
- [ ] Publisher confirms marketplace categories; the source proposal is `Data;Finance`.
- [ ] Publisher confirms public support and privacy URLs in Partner Center.

## Required platform validation

- [ ] Import `apiDefinition.swagger.json`, `apiProperties.json`, and `icon.png` into a custom connector inside a solution.
- [ ] Run Solution Checker and resolve every error.
- [ ] Create a dedicated test flow inside a solution.
- [ ] Run at least ten successful calls per discovered tool and complete the cases in `reviewer-evaluation.md`.
- [ ] Confirm the custom-connector Test surface and an agent show no runtime or schema errors.
- [ ] If the separate Copilot Studio dynamic-discovery path is submitted, complete an end-to-end secretless public-client connection test; do not treat Microsoft 365 DCR as compatible without separate evidence.
- [ ] Export the connector solution and test-flow solution without modifying their generated contents.
- [ ] Create the final package with the exported solutions and `intro.md`.
- [ ] Run Microsoft's `ConnectorPackageValidator.ps1` against the final zip.
- [ ] Upload the package to a private blob and create a SAS URI valid for at least 15 days.

## Secure reviewer access

- [ ] Create a dedicated, least-privileged reviewer developer account.
- [ ] Deliver its key only through Microsoft's secure submission field as `Bearer <key>`.
- [ ] Do not place the key in source control, `intro.md`, agent instructions, screenshots, issue comments, or email body text.
- [ ] Revoke the reviewer key after the review unless Microsoft requires continuing access.

## Partner Center submission

- [ ] Create a **Connectors & Agents in Microsoft Copilot Studio** offer.
- [ ] Supply the package SAS URI.
- [ ] Select legal, privacy, support, category, and availability options.
- [ ] Publish for certification and retain the submission reference.
- [ ] Review Microsoft's certification report within Partner Center.
- [ ] Test the time-limited preview environment if the package passes certification.
- [ ] Provide publisher signoff only after the preview passes all reviewer cases.

## Post-publication owner duties

- [ ] Monitor endpoint health, authentication, request errors, and review-support mail.
- [ ] Keep public documentation and limitations current.
- [ ] Resubmit when the endpoint, authentication, or exposed tool contract changes materially.
- [ ] Rotate or revoke review credentials without disrupting customer credentials.
- [ ] Preserve the certified source package and exact production commit for auditability.
