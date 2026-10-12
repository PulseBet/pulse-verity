"""CI-only SDK test fixtures. No network, model calls, or child processes."""
from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

# This file is imported before any framework, including their telemetry setup.
os.environ.update({
    "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false",
    "OTEL_SDK_DISABLED": "true", "CREWAI_TELEMETRY_ENABLED": "false",
    "CREWAI_TRACING_ENABLED": "false", "CREWAI_TESTING": "true",
})


def deny_network(event, args):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
        raise AssertionError("Runtime checks must not access the network")


sys.addaudithook(deny_network)
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]
from common import ExampleError, TOOL_NAMES  # noqa: E402
from test_common import RECEIPT, VERIFIED  # noqa: E402


def tool_definitions(types, *, missing=False):
    # These synthetic schemas exercise preservation of nested signed fields.
    fields = {
        key: {"type": "object" if isinstance(value, dict) else
              "number" if isinstance(value, (float, int)) else "string"}
        for key, value in RECEIPT.items()
    }
    definitions = [
        types.Tool(name="get_index_price", description="Synthetic price read", inputSchema={
            "type": "object", "properties": {"symbol": {"type": "string"}},
            "required": ["symbol"],
        }),
        types.Tool(name="verify_print", description="Synthetic verification", inputSchema={
            "type": "object", "properties": fields, "required": list(fields),
        }),
        types.Tool(name="submit_verity_feedback", description="Must never be called", inputSchema={
            "type": "object", "properties": {},
        }),
    ]
    return [tool for tool in definitions if not (missing and tool.name == "verify_print")]


class Responses:
    def __init__(self, mode="success"):
        self.mode = mode
        self.calls = []

    def payload(self, name, arguments):
        if name not in TOOL_NAMES:
            raise AssertionError("An unapproved tool was invoked")
        self.calls.append((name, deepcopy(arguments)))
        if self.mode == "tool_error":
            return {"error": {"code": "SYNTHETIC_FAILURE"}}
        if name == "get_index_price":
            return deepcopy(RECEIPT)
        return {**VERIFIED, "recordValid": self.mode != "reject"}

    def mcp_result(self, types, name, arguments):
        payload = self.payload(name, arguments)
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=json.dumps(payload))],
            structuredContent=payload, isError=self.mode == "tool_error",
        )


class RuntimeCase(unittest.TestCase):
    def setUp(self):
        # Framework imports also happen under these guards. A missed transport
        # patch fails instead of launching npx or opening a live connection.
        self.addCleanup(patch.stopall)
        patch("subprocess.Popen", side_effect=AssertionError("No child processes in runtime checks")).start()
        patch.dict(os.environ, {"PULSE_API_KEY": "synthetic-key"}).start()

    def assert_calls(self, responses):
        expected = [] if responses.mode == "missing" else [
            ("get_index_price", {"symbol": "BTC"}),
        ]
        if responses.mode in {"success", "reject"}:
            expected.append(("verify_print", RECEIPT))
        self.assertEqual(responses.calls, expected)

    def assert_outcome(self, run, responses):
        if responses.mode == "success":
            result = run()
            self.assertIs(result["recordValid"], True)
            self.assertEqual(result["priceText"], RECEIPT["priceText"])
            self.assertIs(result["freshnessAssessed"], False)
            self.assertEqual(result["quality"]["confidence"], 0.5)
        else:
            with self.assertRaises(ExampleError):
                run()
        self.assert_calls(responses)
