"""Bounded, offline tests: synthetic MCP responses, never real prices or keys."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import (  # noqa: E402
    ExampleError, MAX_RESULT_BYTES, MCP_URL, NPM_PACKAGE, TOOL_NAMES,
    checked_print, cli, decode_result, hosted_headers, key_environment,
    read_and_verify, read_and_verify_sync, select_tools, validate_symbol, verified_summary,
)

RECEIPT = {
    "symbol": "BTC", "price": 123.45, "priceText": "123.4500",
    "at": "2026-01-01T00:00:00.000Z", "grade": "consensus", "kid": "synthetic",
    "signature": "A" * 86 + "==", "confidence": 0.5,
    "cadence": {"band": "real-time", "calculatedAgeMs": 12},
    "v2": {"sig": "pulse-index-v2", "canonical": "synthetic\nbytes\n", "signature": "B" * 86 + "==", "kid": "synthetic"},
    "requestId": "00000000-0000-4000-8000-000000000000",
}
VERIFIED = {"recordValid": True, "valid": True, "metadataSigned": True, "verificationScope": "full-record"}


class ResultsTest(unittest.TestCase):
    def test_transport_destinations_and_pin(self):
        self.assertEqual(MCP_URL, "https://mcp.thepulse.markets/api/index/mcp")
        self.assertEqual(NPM_PACKAGE, "pulse-verity@1.3.1")

    def test_only_explicit_tools_are_selected(self):
        tools = [SimpleNamespace(name=name) for name in (*TOOL_NAMES, "submit_verity_feedback", "new_tool")]
        self.assertEqual(set(select_tools(tools)), set(TOOL_NAMES))

    def test_missing_or_duplicate_tools_fail(self):
        for names in [("get_index_price",), (*TOOL_NAMES, "verify_print")]:
            with self.subTest(names=names), self.assertRaises(ExampleError):
                select_tools(SimpleNamespace(name=n) for n in names)

    def test_symbol_validation(self):
        self.assertEqual(validate_symbol("bTc"), "BTC")
        for value in ("", "BTC/USDT", "BTC\n", "x" * 21):
            with self.subTest(value=value), self.assertRaises(ExampleError):
                validate_symbol(value)

    def test_keyless_and_only_required_environment(self):
        with patch.dict("os.environ", {"ANOTHER_SECRET": "synthetic-other"}, clear=True):
            self.assertEqual(key_environment(), {})
            with self.assertRaises(ExampleError):
                hosted_headers()
        with patch.dict("os.environ", {"PULSE_API_KEY": "synthetic-key", "ANOTHER_SECRET": "synthetic-other"}, clear=True):
            self.assertEqual(key_environment(), {"PULSE_API_KEY": "synthetic-key"})
            self.assertEqual(hosted_headers(), {"Authorization": "Bearer synthetic-key"})

    def test_header_injection_rejected_without_echo(self):
        with patch.dict("os.environ", {"PULSE_API_KEY": "synthetic\r\nheader"}, clear=True):
            with self.assertRaises(ExampleError) as caught:
                hosted_headers()
            self.assertNotIn("synthetic", str(caught.exception))

    def test_current_langchain_structured_artifact(self):
        message = SimpleNamespace(status="success", artifact={"structured_content": RECEIPT}, content="ignored")
        self.assertIs(decode_result(message), RECEIPT)

    def test_adk_structured_envelope(self):
        result = {"isError": False, "structuredContent": RECEIPT, "content": []}
        self.assertIs(decode_result(result), RECEIPT)

    def test_crewai_json_text(self):
        self.assertEqual(decode_result(json.dumps(RECEIPT)), RECEIPT)

    def test_text_block_fallback(self):
        content = [{"type": "text", "text": json.dumps(RECEIPT)}]
        self.assertEqual(decode_result(content), RECEIPT)
        self.assertEqual(decode_result({"content": content}), RECEIPT)

    def test_errors_do_not_become_prices_or_echo_remote_data(self):
        cases = [
            {"error": {"code": "MONTHLY_LIMIT", "raw": "synthetic-secret"}},
            {"error": {"code": "RATE_LIMITED", "retryAfterSeconds": 30}},
            {"isError": True, "structuredContent": RECEIPT, "content": []},
            {"success": False, "price": 0},
            SimpleNamespace(status="error", artifact={"structured_content": RECEIPT}),
        ]
        for result in cases:
            with self.subTest(result=type(result)), self.assertRaises(ExampleError) as caught:
                decode_result(result)
            self.assertNotIn("synthetic-secret", str(caught.exception))

    def test_bad_or_oversized_results_fail(self):
        for result in (None, "[]", "not JSON", [{"type": "image"}], [1, 2], " " * (MAX_RESULT_BYTES + 1)):
            with self.subTest(result=type(result)), self.assertRaises(ExampleError):
                decode_result(result)

    def test_failed_record_verification_never_passes(self):
        for replacement in (False, None, 1, "true"):
            with self.subTest(value=replacement), self.assertRaises(ExampleError):
                verified_summary(RECEIPT, {**VERIFIED, "recordValid": replacement})
        for field, value in [("valid", False), ("metadataSigned", False), ("verificationScope", "price-only")]:
            with self.subTest(field=field), self.assertRaises(ExampleError):
                verified_summary(RECEIPT, {**VERIFIED, field: value})

    def test_price_only_response_fails(self):
        with self.assertRaises(ExampleError):
            verified_summary(RECEIPT, {"valid": True, "recordValid": False, "verificationScope": "price-only"})

    def test_receipt_symbol_and_unavailable_prices_fail(self):
        with self.assertRaises(ExampleError):
            checked_print({**RECEIPT, "symbol": "ETH"}, "BTC")
        for price in (0, None, False, float("nan"), float("inf")):
            with self.subTest(price=price), self.assertRaises(ExampleError):
                checked_print({**RECEIPT, "price": price}, "BTC")

    def test_summary_preserves_exact_price_and_does_not_claim_freshness(self):
        result = verified_summary(RECEIPT, VERIFIED)
        self.assertEqual(result["priceText"], "123.4500")
        self.assertFalse(result["freshnessAssessed"])
        self.assertFalse(result["unsignedContext"]["sample"])
        self.assertEqual(result["grade"], "consensus")
        self.assertEqual(result["quality"]["confidence"], 0.5)
        self.assertEqual(result["quality"]["cadence"]["calculatedAgeMs"], 12)
        self.assertNotIn("signature", result)

    def test_unsigned_quality_extras_are_not_presented_as_authenticated(self):
        receipt = deepcopy(RECEIPT)
        receipt["cadence"]["updatesLast120s"] = 100
        receipt["cadence"]["injected"] = "not signed"
        result = verified_summary(receipt, VERIFIED)
        self.assertNotIn("updatesLast120s", result["quality"]["cadence"])
        self.assertNotIn("injected", result["quality"]["cadence"])

    def test_no_retry_after_first_error(self):
        calls = []
        def call(name, args):
            calls.append(name)
            return {"error": {"code": "MONTHLY_LIMIT"}}
        with self.assertRaises(ExampleError):
            read_and_verify_sync(call, "BTC")
        self.assertEqual(calls, ["get_index_price"])

    def test_sync_order_and_unchanged_flat_verify_arguments(self):
        receipt = deepcopy(RECEIPT)
        calls = []
        def call(name, args):
            calls.append((name, deepcopy(args)))
            return receipt if name == "get_index_price" else VERIFIED
        result = read_and_verify_sync(call, "BTC")
        self.assertEqual(calls, [("get_index_price", {"symbol": "BTC"}), ("verify_print", RECEIPT)])
        self.assertEqual(receipt, RECEIPT)
        self.assertTrue(result["recordValid"])

    def test_async_order_and_unchanged_flat_verify_arguments(self):
        calls = []
        async def call(name, args):
            calls.append((name, deepcopy(args)))
            return RECEIPT if name == "get_index_price" else VERIFIED
        result = asyncio.run(asyncio.wait_for(read_and_verify(call, "BTC"), timeout=1))
        self.assertEqual(calls, [("get_index_price", {"symbol": "BTC"}), ("verify_print", RECEIPT)])
        self.assertTrue(result["recordValid"])

    def test_cli_suppresses_sdk_exception_and_traceback(self):
        def failure(*args):
            raise RuntimeError("Authorization: Bearer synthetic-secret")
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", ["example"]), patch("sys.stdout", output), patch("sys.stderr", errors), patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(SystemExit):
                cli(failure, asynchronous=False)
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn("synthetic-secret", errors.getvalue())
        self.assertNotIn("Traceback", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
