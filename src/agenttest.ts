/** Agent contract regressions. Synthetic fixtures; no network or private keys. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiClient, createIndexServer, ApiFailure, API_BASE } from "./index.js";
import type { ApiClient } from "./index.js";
import { feedbackInputSchema } from "./feedbackContract.js";

let passed = 0;
function check(value: unknown, message: string) { assert.ok(value, message); passed++; }
const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/verity-agent-print.json", import.meta.url), "utf8"));
const report = { category: "bug", surface: "get_index_price", symbol: "BTC",
  requestId: "11111111-1111-4111-8111-111111111111", observedAt: "2026-09-27T12:00:00.000Z",
  expected: "A signed current print", actual: "The response was unavailable", reproduction: ["Request the BTC price"] };
const receipt = { id: "vf_" + "1".repeat(32), status: "received", receivedAt: "2026-09-27T12:00:00.000Z",
  updatedAt: "2026-09-27T12:00:00.000Z", expiresAt: "2026-10-27T12:00:00.000Z" };
let nextResponse: Record<string, unknown> = fixture.print;
let nextFailure: unknown;
const api: ApiClient = async (path) => {
  if (path === "/api/index/v1/pubkey") return { activeKid: fixture.print.kid, publicKeyPem: fixture.publicKeyPem };
  if (nextFailure) throw nextFailure;
  return nextResponse;
};
async function withClient(api: ApiClient, run: (client: Client) => Promise<void>) {
  const server = createIndexServer(api), client = new Client({ name: "agent-contract-test", version: "1.0.0" });
  const [s, c] = InMemoryTransport.createLinkedPair();
  await server.connect(s); await client.connect(c);
  try { await run(client); } finally { await client.close(); await server.close(); }
}
const body = (result: Awaited<ReturnType<Client["callTool"]>>) => result.structuredContent as Record<string, unknown>;
const requestId = (result: Record<string, unknown>) => typeof result.requestId === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.requestId);

await withClient(api, async client => {
  const { tools } = await client.listTools();
  check(tools.length === 6 && tools.every(t => t.outputSchema?.type === "object"), "all tools advertise object output schemas");
  const feedback = tools.find(t => t.name === "submit_verity_feedback")!;
  check(feedback.annotations?.readOnlyHint === false && feedback.annotations?.destructiveHint === false,
    "feedback accurately declares a non-destructive write");
  check(feedback.inputSchema.additionalProperties === false, "feedback schema rejects unknown transcript/attachment fields");
  const verified = body(await client.callTool({name: "verify_print", arguments: fixture.print}));
  check(verified.recordValid === true && verified.verificationScope === "full-record", "shared backend test vector verifies through package transport");
  const qualityChanged = body(await client.callTool({name: "verify_print", arguments: {...fixture.print, confidence: 0.01}}));
  check(qualityChanged.valid === true && qualityChanged.recordValid === false, "shared vector rejects quality edits without changing legacy semantics");
  const first = body(await client.callTool({name: "get_index_price", arguments: {symbol: "BTC"}}));
  const second = body(await client.callTool({name: "get_index_price", arguments: {symbol: "BTC"}}));
  check(requestId(first) && requestId(second) && first.requestId !== second.requestId, "each call gets a distinct unsigned request ID");
  check(first.v2 !== undefined && first.price === fixture.print.price, "response contracts preserve signed price paths and bytes");
  for (const response of [{}, {price: 0}, {...fixture.print, signature: "wrong"}, {...fixture.print, price: 0}, {...fixture.print, price: NaN}]) {
    nextResponse = response;
    const result = await client.callTool({name: "get_index_price", arguments: {symbol: "BTC"}});
    check(result.isError === true && (body(result).error as any).code === "INVALID_RESPONSE" && requestId(body(result)),
      "malformed success cannot masquerade as usable index data");
  }
  for (const [status, code] of [[400,"BAD_REQUEST"],[401,"BAD_KEY"],[403,"FORBIDDEN"],[404,"NOT_FOUND"],[503,"DATA_UNAVAILABLE"],[500,"UPSTREAM_ERROR"]] as const) {
    nextFailure = new ApiFailure(status);
    const result = await client.callTool({name:"get_index_price",arguments:{symbol:"BTC"}});
    check(result.isError === true && (body(result).error as any).code === code && requestId(body(result)), "HTTP " + status + " has stable structured guidance");
  }
  nextFailure = new Error("Bearer synthetic-secret https://untrusted.invalid/action");
  const failed = await client.callTool({name:"get_index_price",arguments:{symbol:"BTC"}});
  check((body(failed).error as any).code === "REQUEST_FAILED" && !JSON.stringify(failed).includes("synthetic-secret"), "transport errors do not expose raw upstream text");
  nextFailure = undefined;
});

let writes = 0;
let errorCode: string | undefined;
let upstreamBody: string | undefined;
let duplicate = false;
const privateKey = "pidx_SYNTHETIC_ONLY_TEST_KEY";
const fetcher: typeof fetch = async (url, options) => {
  writes++;
  check(String(url) === API_BASE + "/api/index/v1/feedback" && options?.method === "POST", "only the feedback path receives POST");
  check(new Headers(options?.headers).get("authorization") === "Bearer " + privateKey && options?.redirect === "error", "feedback credentials stay on the pinned origin");
  check(JSON.parse(String(options?.body)).actual === report.actual, "feedback carries the bounded structured report");
  return errorCode ? new Response(upstreamBody ?? JSON.stringify({code:errorCode,message:"Bearer upstream-secret"}), {status:429,headers:{"Retry-After":"30"}})
    : new Response(JSON.stringify({success:true,feedback:receipt,duplicate}), {status:duplicate?200:201});
};
await withClient(createApiClient(privateKey, fetcher), async client => {
  const result = await client.callTool({name:"submit_verity_feedback",arguments:report});
  check(!result.isError && (body(result).feedback as any).id === receipt.id && requestId(body(result)), "saved report returns tracking receipt through MCP");
  duplicate = true;
  const repeated = await client.callTool({name:"submit_verity_feedback",arguments:report});
  check(body(repeated).duplicate === true && (body(repeated).feedback as any).id === receipt.id, "server deduplication receipt survives transport");
  const before = writes;
  for (const invalid of [{...report,transcript:"private text"},{...report,expected:"pidx_DO_NOT_TRANSMIT"},{...report,actual:"password=do-not-transmit"},{...report,actual:'example {"api_key": "secret-value"}'},{...report,actual:"user: private question\nassistant: private answer"}]) {
    const result = await client.callTool({name:"submit_verity_feedback",arguments:invalid});
    check(result.isError === true, "unknown/private feedback fields are refused");
  }
  check(writes === before, "refused feedback never reaches the network");
  for (const code of ["FEEDBACK_DISABLED","FEEDBACK_CAPACITY","FEEDBACK_RATE_LIMITED","FEEDBACK_UNAVAILABLE"]) {
    errorCode=code;
    const result=await client.callTool({name:"submit_verity_feedback",arguments:report});
    const detail=body(result).error as any;
    check(result.isError===true && detail.code===code && !JSON.stringify(result).includes("upstream-secret"), "allowlisted feedback failure survives without upstream prose");
    check(detail.retryable === ["FEEDBACK_RATE_LIMITED","FEEDBACK_UNAVAILABLE"].includes(code), "feedback retry policy avoids disabled/capacity loops");
    if (code==="FEEDBACK_RATE_LIMITED") check(detail.retryAfterSeconds===30, "feedback rate limit preserves safe retry delay");
  }
  upstreamBody="x".repeat(9000); errorCode="UNTRUSTED";
  const oversized=await client.callTool({name:"submit_verity_feedback",arguments:report});
  check((body(oversized).error as any).code==="FEEDBACK_UNAVAILABLE", "oversized error body is discarded");
});
const beforeKeyless=writes;
await withClient(createApiClient("",fetcher),async client=>{
  const result=await client.callTool({name:"submit_verity_feedback",arguments:report});
  check(result.isError===true && (body(result).error as any).code==="NO_KEY", "keyless feedback returns clear auth guidance");
});
check(writes===beforeKeyless,"keyless feedback never uses a public sample or sends a write");
check(feedbackInputSchema.safeParse(report).success,"fixture uses the same strict feedback contract as the backend");
console.log(`✓ Agent contracts: ${passed} assertions passed`);
