"""Offline wire and real-SDK tests. No credentials, servers, or LLM calls."""

import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import yaml
from dify_plugin import DifyPluginEnv
from dify_plugin.core.plugin_registration import PluginRegistration
from dify_plugin.entities.tool import ToolRuntime
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from lib.verity_mcp import (
    MAX_RESPONSE_BYTES, MCP_URL, PROTOCOL_VERSION, VerityError, VerityMcp,
)
from provider.pulse_verity import PulseVerityProvider
from tools.get_verified_price import GetVerifiedPriceTool

# Deliberately synthetic. This key is never sent to the network.
KEY = "pidx_synthetic_test_credential_000000"
PRINT = json.loads((Path(__file__).resolve().parents[3] / "fixtures/verity-agent-print.json").read_text())["print"]
VERIFIED = {
    "valid": True, "recordValid": True, "metadataSigned": True,
    "verificationScope": "full-record", "verifiedWithKid": "synthetic-agent-fixture",
    "checked": "synthetic fixture", "keySource": "https://mcp.thepulse.markets/api/index/v1/pubkey",
    "v2": {"valid": True, "signatureValid": True, "fieldsMatch": True,
           "mismatches": [], "signedFields": {"symbol": "BTC"},
           "verifiedWithKid": "synthetic-agent-fixture"},
}


class Chunks(httpx.SyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks


class Wire:
    def __init__(self, *, printed=None, verified=None, mode="json", tool_error=None):
        self.printed = copy.deepcopy(PRINT if printed is None else printed)
        self.verified = copy.deepcopy(VERIFIED if verified is None else verified)
        self.mode = mode
        self.tool_error = tool_error
        self.requests = []

    def __call__(self, request):
        body = json.loads(request.content)
        self.requests.append((request, body))
        if body["method"] == "notifications/initialized":
            return httpx.Response(202)
        if body["method"] == "initialize":
            result = {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}},
                      "serverInfo": {"name": "synthetic", "version": "0"}}
        else:
            name = body["params"]["name"]
            if name == "get_index_price" and self.tool_error:
                result = self.tool_error
            else:
                content = self.printed if name == "get_index_price" else self.verified
                if self.mode == "text":
                    result = {"content": [{"type": "text", "text": json.dumps(content)}]}
                else:
                    result = {"structuredContent": content, "content": []}
        envelope = {"jsonrpc": "2.0", "id": body["id"], "result": result}
        if self.mode == "sse":
            event = ("event: message\r\ndata: " + json.dumps(envelope) + "\r\n\r\n").encode()
            return httpx.Response(200, headers={"content-type": "text/event-stream"},
                                  stream=Chunks([event[:17], event[17:57], event[57:]]))
        return httpx.Response(200, json=envelope)


def client_for(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), trust_env=False)


class ContractTests(unittest.TestCase):
    def test_full_print_unchanged_and_pinned_origin(self):
        wire = Wire()
        with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
            result = client.get_verified_price("btc")
        self.assertTrue(result["success"])
        self.assertEqual(result["print"], PRINT)
        calls = [body for _, body in wire.requests]
        self.assertEqual([body["method"] for body in calls],
                         ["initialize", "notifications/initialized", "tools/call", "tools/call"])
        self.assertEqual(calls[-1]["params"], {"name": "verify_print", "arguments": PRINT})
        for request, _ in wire.requests:
            self.assertEqual(str(request.url), MCP_URL)
            self.assertEqual(request.headers["authorization"], "Bearer " + KEY)
            self.assertLessEqual(request.extensions["timeout"]["read"], 15)

    def test_sse_chunked_transport(self):
        wire = Wire(mode="sse")
        with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
            self.assertTrue(client.get_verified_price("BTC")["recordValid"])

    def test_legacy_mcp_json_text_content(self):
        wire = Wire(mode="text")
        with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
            self.assertTrue(client.get_verified_price("BTC")["recordValid"])

    def test_price_only_false_missing_and_truthy_record_valid_fail_closed(self):
        cases = [False, None, "true", 1]
        for value in cases:
            with self.subTest(recordValid=value):
                verified = copy.deepcopy(VERIFIED)
                if value is None:
                    del verified["recordValid"]
                else:
                    verified["recordValid"] = value
                wire = Wire(verified=verified)
                with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
                    with self.assertRaises(VerityError) as raised:
                        client.get_verified_price("BTC")
                self.assertEqual(raised.exception.code, "UNVERIFIED")
                self.assertNotIn("print", raised.exception.result())

    def test_inconsistent_verification_flags_fail_closed(self):
        for field, value in [("valid", False), ("metadataSigned", False), ("verificationScope", "price-only")]:
            with self.subTest(field=field):
                verified = {**VERIFIED, field: value}
                with client_for(Wire(verified=verified)) as http, VerityMcp(KEY, client=http) as client:
                    with self.assertRaises(VerityError) as raised:
                        client.get_verified_price("BTC")
                self.assertEqual(raised.exception.code, "UNVERIFIED")

    def test_invalid_symbol_never_calls_network(self):
        for symbol in [None, "", "BTC/USD", "BTC\n", "x" * 21, {"url": "https://example.com"}]:
            wire = Wire()
            with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
                with self.assertRaises(VerityError):
                    client.get_verified_price(symbol)
            self.assertEqual(wire.requests, [])

    def test_missing_invalid_key_never_constructs_transport(self):
        for key in [None, "", "test", KEY + "\r\nInjected: header"]:
            with patch("lib.verity_mcp.httpx.Client") as factory:
                with self.assertRaises(VerityError):
                    VerityMcp(key)
                factory.assert_not_called()

    def test_no_other_mcp_tools_allowed(self):
        wire = Wire()
        with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
            with self.assertRaises(VerityError):
                client._tool("submit_verity_feedback", {})
        self.assertEqual(wire.requests, [])

    def test_failure_bodies_and_redirects_never_escape_or_retry(self):
        for status, code in [(401, "CREDENTIALS"), (403, "ACCESS_DENIED"),
                             (429, "REQUEST_LIMIT"), (503, "UNAVAILABLE"), (302, "UNAVAILABLE")]:
            seen = []
            def response(request):
                seen.append(request)
                return httpx.Response(status, text="private " + KEY,
                                      headers={"location": "https://untrusted.example/"})
            with self.subTest(status=status), client_for(response) as http, VerityMcp(KEY, client=http) as client:
                with self.assertRaises(VerityError) as raised:
                    client.get_verified_price("BTC")
                self.assertEqual(raised.exception.code, code)
                self.assertNotIn(KEY, str(raised.exception))
                self.assertNotIn(KEY, json.dumps(raised.exception.result()))
                self.assertEqual(len(seen), 1)
                self.assertEqual(str(seen[0].url), MCP_URL)

    def test_transport_and_timeout_errors_are_sanitized_without_retry(self):
        for error_type in [httpx.ReadTimeout, httpx.ConnectError]:
            seen = []
            def failure(request):
                seen.append(request)
                raise error_type(KEY, request=request)
            with client_for(failure) as http, VerityMcp(KEY, client=http) as client:
                with self.assertRaises(VerityError) as raised:
                    client.get_verified_price("BTC")
            self.assertEqual(len(seen), 1)
            self.assertNotIn(KEY, str(raised.exception))

    def test_mcp_errors_no_price_and_safe_quota_code(self):
        for code in ["MONTHLY_LIMIT", "RATE_LIMITED", KEY, {"malformed": True}]:
            error = {"isError": True, "content": [{"type": "text", "text": "raw remote error"}],
                     "structuredContent": {"error": {"code": code}}}
            wire = Wire(tool_error=error)
            with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
                with self.assertRaises(VerityError) as raised:
                    client.get_verified_price("BTC")
            self.assertEqual(len(wire.requests), 3)
            self.assertNotIn("print", raised.exception.result())
            self.assertNotIn(KEY, str(raised.exception))
            if code in ("MONTHLY_LIMIT", "RATE_LIMITED"):
                self.assertEqual(raised.exception.code, code)

    def test_invalid_price_or_symbol_stops_before_verification(self):
        for changed in [{"symbol": "ETH"}, {"price": 0}, {"price": True}, {"price": None}]:
            wire = Wire(printed={**PRINT, **changed})
            with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
                with self.assertRaises(VerityError):
                    client.get_verified_price("BTC")
            self.assertEqual(len(wire.requests), 3)

    def test_credential_echo_success_is_rejected_including_json_escapes(self):
        for mode in ["json", "text", "sse"]:
            wire = Wire(printed={**PRINT, "note": KEY}, mode=mode)
            with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
                with self.assertRaises(VerityError) as raised:
                    client.get_verified_price("BTC")
                self.assertEqual(raised.exception.code, "INVALID_RESPONSE")
                self.assertNotIn(KEY, json.dumps(raised.exception.result()))
        def escaped(request):
            request_id = json.loads(request.content)["id"]
            content = json.dumps({"jsonrpc": "2.0", "id": request_id, "result": {"secret": KEY}})
            return httpx.Response(200, headers={"content-type": "application/json"},
                                  text=content.replace("pidx_", "\\u0070idx_"))
        with client_for(escaped) as http, VerityMcp(KEY, client=http) as client:
            with self.assertRaises(VerityError):
                client.initialize()

    def test_malformed_wrong_id_and_oversized_response(self):
        for body in [b"not json", b"[]", b'{"jsonrpc":"2.0","id":"wrong","result":{}}',
                     b"x" * (MAX_RESPONSE_BYTES + 1)]:
            with client_for(lambda _: httpx.Response(200, content=body,
                            headers={"content-type": "application/json"})) as http, VerityMcp(KEY, client=http) as client:
                with self.assertRaises(VerityError) as raised:
                    client.initialize()
                self.assertEqual(raised.exception.code, "INVALID_RESPONSE")

    def test_deadline_prevents_next_request(self):
        wire = Wire()
        with client_for(wire) as http, VerityMcp(KEY, client=http) as client:
            client._deadline = 0
            with self.assertRaises(VerityError) as raised:
                client.initialize()
        self.assertEqual(raised.exception.code, "TIMEOUT")
        self.assertEqual(wire.requests, [])

    def test_compressed_response_rejected_before_decompression(self):
        def response(_request):
            return httpx.Response(200, headers={"content-type": "application/json", "content-encoding": "gzip"},
                                  stream=Chunks([b"not a gzip stream"]))
        with client_for(response) as http, VerityMcp(KEY, client=http) as client:
            with self.assertRaises(VerityError) as raised:
                client.initialize()
            self.assertEqual(raised.exception.code, "INVALID_RESPONSE")


class SdkTests(unittest.TestCase):
    def test_actual_sdk_registration_and_asset(self):
        registration = PluginRegistration(DifyPluginEnv())
        self.assertEqual(set(registration.tools_mapping), {"pulse_verity"})
        _, provider_class, tools = registration.tools_mapping["pulse_verity"]
        self.assertEqual(provider_class.__name__, "PulseVerityProvider")
        self.assertEqual(set(tools), {"get_verified_price"})
        self.assertEqual(tools["get_verified_price"][1].__name__, "GetVerifiedPriceTool")
        self.assertTrue(any(asset.filename == "icon.png" for asset in registration.files))
        provider = yaml.safe_load(Path("provider/pulse_verity.yaml").read_text())
        self.assertEqual(provider["credentials_for_provider"]["pulse_api_key"]["type"], "secret-input")
        manifest = yaml.safe_load(Path("manifest.yaml").read_text())
        self.assertEqual(manifest["resource"]["permission"], {})

    def _tool(self):
        return GetVerifiedPriceTool(runtime=ToolRuntime(
            credentials={"pulse_api_key": KEY}, user_id=None, session_id=None), session=None)

    def test_sdk_tool_emits_verified_json(self):
        wire = Wire()
        with client_for(wire) as http:
            with patch("tools.get_verified_price.VerityMcp", side_effect=lambda key: VerityMcp(key, client=http)):
                messages = list(self._tool()._invoke({"symbol": "BTC"}))
        self.assertEqual(len(messages), 5)
        self.assertEqual(messages[0].type.value, "json")
        self.assertTrue(messages[0].message.json_object["recordValid"])
        variables = {message.message.variable_name: message.message.variable_value for message in messages[1:]}
        self.assertTrue(variables["success"])
        self.assertTrue(variables["recordValid"])
        self.assertEqual(variables["print"], PRINT)

    def test_sdk_tool_unverified_failure_has_no_print(self):
        wire = Wire(verified={**VERIFIED, "recordValid": False})
        with client_for(wire) as http:
            with patch("tools.get_verified_price.VerityMcp", side_effect=lambda key: VerityMcp(key, client=http)):
                result = list(self._tool()._invoke({"symbol": "BTC"}))[0].message.json_object
        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "UNVERIFIED")
        self.assertNotIn("print", result)

    def test_sdk_tool_unexpected_exception_does_not_leak(self):
        with patch("tools.get_verified_price.VerityMcp", side_effect=RuntimeError(KEY)):
            result = list(self._tool()._invoke({"symbol": "BTC"}))[0].message.json_object
        self.assertFalse(result["success"])
        self.assertNotIn(KEY, json.dumps(result))

    def test_credential_validation_initializes_without_price_call(self):
        wire = Wire()
        with client_for(wire) as http:
            with patch("provider.pulse_verity.VerityMcp", side_effect=lambda key: VerityMcp(key, client=http)):
                PulseVerityProvider()._validate_credentials({"pulse_api_key": KEY})
        self.assertEqual([body["method"] for _, body in wire.requests], ["initialize"])

    def test_credential_validation_sanitizes_all_exception_types(self):
        for error in [VerityError("CREDENTIALS"), RuntimeError(KEY)]:
            with patch("provider.pulse_verity.VerityMcp", side_effect=error):
                with self.assertRaises(ToolProviderCredentialValidationError) as raised:
                    PulseVerityProvider()._validate_credentials({"pulse_api_key": KEY})
            self.assertNotIn(KEY, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
