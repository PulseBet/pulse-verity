"""Bounded adapter for two existing hosted MCP tools; no pricing or crypto code."""

import json
import math
import re
import time
import uuid
from typing import Any

import httpx

MCP_URL = "https://mcp.thepulse.markets/api/index/mcp"
PROTOCOL_VERSION = "2025-03-26"
MAX_RESPONSE_BYTES = 1_048_576
REQUEST_TIMEOUT_SECONDS = 15
MAX_CALL_SECONDS = 60
ALLOWED_TOOLS = frozenset({"get_index_price", "verify_print"})

MESSAGES = {
    "INVALID_SYMBOL": "Use a crypto ticker with 1 to 20 letters or digits.",
    "CREDENTIALS": "Enter a valid Pulse developer key in the provider's private credential field.",
    "ACCESS_DENIED": "This developer key does not have access. Review access in the Pulse developer portal.",
    "REQUEST_LIMIT": "The account request limit was reached. Review account access; no retry was attempted.",
    "MONTHLY_LIMIT": "The monthly allowance is exhausted. Review access or wait for its reset; do not retry now.",
    "RATE_LIMITED": "The service rate limit was reached. Wait before retrying manually.",
    "UNAVAILABLE": "Pulse data is unavailable. No verified price was returned; retry manually later.",
    "TIMEOUT": "Pulse did not complete within the request limit. No retry was attempted.",
    "INVALID_RESPONSE": "Pulse returned an unsupported or malformed response. No verified price was returned.",
    "UNVERIFIED": "The hosted verifier did not confirm recordValid=true for the complete print. No verified price was returned.",
}


class VerityError(Exception):
    def __init__(self, code: str):
        self.code = code if code in MESSAGES else "UNAVAILABLE"
        self.message = MESSAGES[self.code]
        super().__init__(self.message)

    def result(self) -> dict[str, Any]:
        return {"success": False, "recordValid": False,
                "error": {"code": self.code, "message": self.message}}


def normalize_symbol(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9]{1,20}", value):
        raise VerityError("INVALID_SYMBOL")
    return value.upper()


def _json(text: str) -> Any:
    def reject_constant(_value: str) -> None:
        raise ValueError("Non-finite JSON number")
    return json.loads(text, parse_constant=reject_constant)


class VerityMcp:
    def __init__(self, api_key: Any, *, client: httpx.Client | None = None):
        if not isinstance(api_key, str) or not re.fullmatch(r"pidx_[A-Za-z0-9_-]{16,256}", api_key):
            raise VerityError("CREDENTIALS")
        self._key = api_key
        self._owned_client = client is None
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=5),
            follow_redirects=False, trust_env=False,
            transport=httpx.HTTPTransport(retries=0, trust_env=False),
        )
        self._deadline = time.monotonic() + MAX_CALL_SECONDS

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        if self._owned_client:
            self._client.close()
        self._key = ""

    def _rpc(self, method: str, params: dict[str, Any] | None = None,
             *, notification: bool = False) -> dict[str, Any]:
        request_id = str(uuid.uuid4())
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        if not notification:
            payload["id"] = request_id
        headers = {
            "Authorization": "Bearer " + self._key,
            "Accept": "application/json, text/event-stream",
            "Accept-Encoding": "identity",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }
        try:
            remaining = self._deadline - time.monotonic()
            if remaining <= 0:
                raise VerityError("TIMEOUT")
            with self._client.stream("POST", MCP_URL, json=payload, headers=headers,
                                     timeout=min(REQUEST_TIMEOUT_SECONDS, remaining),
                                     follow_redirects=False) as response:
                if response.status_code == 401:
                    raise VerityError("CREDENTIALS")
                if response.status_code == 403:
                    raise VerityError("ACCESS_DENIED")
                if response.status_code == 429:
                    raise VerityError("REQUEST_LIMIT")
                if response.status_code >= 300 or response.status_code < 200:
                    raise VerityError("UNAVAILABLE")
                if notification:
                    if response.status_code not in (200, 202, 204):
                        raise VerityError("INVALID_RESPONSE")
                    return {}
                media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if media_type not in ("application/json", "text/event-stream"):
                    raise VerityError("INVALID_RESPONSE")
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise VerityError("INVALID_RESPONSE")
                data = bytearray()
                for chunk in response.iter_bytes():
                    if len(data) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise VerityError("INVALID_RESPONSE")
                    data.extend(chunk)
                    if time.monotonic() > self._deadline:
                        raise VerityError("TIMEOUT")
                    # A Streamable HTTP POST can remain open after its response.
                    # Stop as soon as our one complete JSON-RPC result arrives.
                    if media_type == "text/event-stream":
                        message = self._sse_result(bytes(data), request_id)
                        if message is not None:
                            return self._rpc_result(message, request_id)
                text = bytes(data).decode("utf-8")
                self._check_secret(text)
                if media_type == "text/event-stream":
                    raise VerityError("INVALID_RESPONSE")
                return self._rpc_result(_json(text), request_id)
        except VerityError:
            raise
        except httpx.TimeoutException:
            raise VerityError("TIMEOUT") from None
        except (httpx.HTTPError, UnicodeError, ValueError, TypeError, RecursionError):
            raise VerityError("INVALID_RESPONSE") from None

    def _check_secret(self, text: str) -> None:
        if self._key in text or re.search(r"pidx_[A-Za-z0-9_-]{16,}", text):
            raise VerityError("INVALID_RESPONSE")

    def _sse_result(self, data: bytes, request_id: str) -> dict[str, Any] | None:
        # Decode complete events only, allowing a UTF-8 codepoint across chunks.
        normalized = data.replace(b"\r\n", b"\n")
        events = normalized.split(b"\n\n")[:-1]
        for event in events:
            lines = event.decode("utf-8").split("\n")
            content = "\n".join(line[5:].lstrip(" ") for line in lines if line.startswith("data:"))
            if not content:
                continue
            self._check_secret(content)
            message = _json(content)
            if isinstance(message, dict) and message.get("id") == request_id:
                return message
        return None

    def _rpc_result(self, message: Any, request_id: str) -> dict[str, Any]:
        if (not isinstance(message, dict) or message.get("jsonrpc") != "2.0"
                or message.get("id") != request_id or "error" in message):
            raise VerityError("INVALID_RESPONSE")
        result = message.get("result")
        if not isinstance(result, dict):
            raise VerityError("INVALID_RESPONSE")
        # Check the decoded value too, to catch JSON-escaped credentials.
        self._check_secret(json.dumps(result, ensure_ascii=False))
        return result

    def initialize(self) -> None:
        result = self._rpc("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "pulse-verity-dify", "version": "0.0.1"},
        })
        if (result.get("protocolVersion") != PROTOCOL_VERSION
                or not isinstance(result.get("capabilities"), dict)
                or "tools" not in result["capabilities"]):
            raise VerityError("INVALID_RESPONSE")

    def _tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in ALLOWED_TOOLS:
            raise VerityError("INVALID_RESPONSE")
        result = self._rpc("tools/call", {"name": name, "arguments": arguments})
        structured = result.get("structuredContent")
        if result.get("isError") is True:
            code = structured.get("error", {}).get("code") if isinstance(structured, dict) and isinstance(structured.get("error"), dict) else None
            raise VerityError(code if isinstance(code, str) and code in {"MONTHLY_LIMIT", "RATE_LIMITED", "REQUEST_LIMIT"} else "UNAVAILABLE")
        if structured is None:
            content = result.get("content")
            if (not isinstance(content, list) or len(content) != 1
                    or not isinstance(content[0], dict) or content[0].get("type") != "text"
                    or not isinstance(content[0].get("text"), str)):
                raise VerityError("INVALID_RESPONSE")
            try:
                structured = _json(content[0]["text"])
            except (ValueError, TypeError, RecursionError):
                raise VerityError("INVALID_RESPONSE") from None
        if not isinstance(structured, dict) or "error" in structured or structured.get("success") is False:
            raise VerityError("UNAVAILABLE")
        self._check_secret(json.dumps(structured, ensure_ascii=False))
        return structured

    def get_verified_price(self, symbol: str) -> dict[str, Any]:
        symbol = normalize_symbol(symbol)
        self.initialize()
        self._rpc("notifications/initialized", notification=True)
        printed = self._tool("get_index_price", {"symbol": symbol})
        price = printed.get("price")
        if (printed.get("symbol") != symbol or type(price) not in (float, int)
                or not math.isfinite(price) or price <= 0
                or not all(field in printed for field in ("at", "grade", "signature"))):
            raise VerityError("INVALID_RESPONSE")
        # The MCP contract takes print fields as the arguments object (no "print" wrapper).
        # Pass the entire print unchanged, including exact priceText, kid and v2.
        verified = self._tool("verify_print", printed)
        if (verified.get("recordValid") is not True or verified.get("valid") is not True
                or verified.get("metadataSigned") is not True
                or verified.get("verificationScope") != "full-record"):
            raise VerityError("UNVERIFIED")
        return {"success": True, "recordValid": True, "print": printed, "verification": verified}
