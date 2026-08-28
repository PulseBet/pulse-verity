/**
 * Offline self-test: proves the LOCAL verification path — canonical payload
 * layout and IEEE-P1363 ECDSA verify — against a freshly generated P-256
 * key, plus the negative cases that make verification meaningful. Runs with
 * no network and no API key: `npm test`.
 */
import crypto from "node:crypto";
import { canonicalPricePayload, verifySignature, INDEX_SIG_VERSION } from "./index.js";

let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) { console.error(`✗ ${msg}`); process.exit(1); }
  passed += 1;
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

const print = { symbol: "BTC", price: "65123.45", at: "2026-08-27T10:00:00.000Z", grade: "composite" };
ok(canonicalPricePayload(print) === `${INDEX_SIG_VERSION}\nBTC\n65123.45\n2026-08-27T10:00:00.000Z\ncomposite`,
  "canonical payload is the versioned newline join");
ok(canonicalPricePayload({ ...print, price: 65123.45 }) === canonicalPricePayload(print),
  "a JSON-number price and its wire string canonicalize identically");

const signature = crypto.sign("sha256", Buffer.from(canonicalPricePayload(print)),
  { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");

ok(verifySignature({ ...print, signature }, pem), "a genuine print verifies");
ok(!verifySignature({ ...print, price: "65123.46", signature }, pem), "a cent of tampering fails");
ok(!verifySignature({ ...print, symbol: "ETH", signature }, pem), "moving the signature to another symbol fails");
ok(!verifySignature({ ...print, signature: signature.slice(0, -4) + "AAAA" }, pem), "a corrupted signature fails");
const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
ok(!verifySignature({ ...print, signature }, other.publicKey.export({ type: "spki", format: "pem" }).toString()),
  "the wrong public key fails");
ok(!verifySignature({ ...print, signature: "bm90LWEtc2ln" }, pem), "a short non-signature fails without throwing");

console.log(`✓ Pulse Verity Index selftest: ${passed} assertions passed`);
