"""Public MCP result handling shared by the framework examples.

Cryptography and pricing stay in Pulse Verity's MCP tools. These helpers only
check tool errors, preserve the returned receipt, and enforce the result gate.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import sys
from collections.abc import Awaitable, Callable, Iterable, Mapping
from typing import Any

MCP_URL = "https://mcp.thepulse.markets/api/index/mcp"
NPM_PACKAGE = "pulse-verity@1.3.1"
TOOL_NAMES = ("get_index_price", "verify_print")
TIMEOUT_SECONDS = 30
MAX_RESULT_BYTES = 1024 * 1024


class ExampleError(Exception):
    """A locally authored message safe to show without remote bodies or headers."""


def validate_symbol(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9]{1,20}", value):
        raise ExampleError("Use a crypto ticker containing 1–20 letters or digits.")
    return value.upper()


def key_environment() -> dict[str, str]:
    """Forward only the optional Verity key, never the entire parent environment."""
    key = os.environ.get("PULSE_API_KEY", "").strip()
    if key and (len(key) > 4096 or any(c.isspace() for c in key)):
        raise ExampleError("PULSE_API_KEY has an invalid format.")
    return {"PULSE_API_KEY": key} if key else {}


def hosted_headers() -> dict[str, str]:
    key = key_environment().get("PULSE_API_KEY")
    if not key:
        raise ExampleError("Hosted MCP requires PULSE_API_KEY. Use stdio for keyless samples.")
    return {"Authorization": f"Bearer {key}"}


def select_tools(discovered: Iterable[Any]) -> dict[str, Any]:
    """Use an explicit allowlist; never rely on readOnlyHint to grant access."""
    selected: dict[str, Any] = {}
    for tool in discovered:
        if tool.name in TOOL_NAMES:
            if tool.name in selected:
                raise ExampleError("The MCP server advertised a duplicate required tool.")
            selected[tool.name] = tool
    if set(selected) != set(TOOL_NAMES):
        raise ExampleError("The MCP server did not advertise both required read/verify tools.")
    return selected


def _parse_json(text: str) -> dict[str, Any]:
    if len(text.encode("utf-8")) > MAX_RESULT_BYTES:
        raise ExampleError("The MCP result exceeds this example's response limit.")
    try:
        value = json.loads(text)
    except (ValueError, RecursionError):
        raise ExampleError("The MCP result was not a JSON object.") from None
    if not isinstance(value, dict):
        raise ExampleError("The MCP result was not a JSON object.")
    return value


def decode_result(result: Any) -> dict[str, Any]:
    """Read LangChain ToolMessage, ADK MCP envelope, or CrewAI JSON text.

    Prefer structured output when present. Only accept one JSON text block as
    fallback; ambiguous or multimodal results cannot be treated as price data.
    """
    if getattr(result, "status", None) == "error":
        raise ExampleError("The MCP tool reported an error; no price was verified.")
    artifact = getattr(result, "artifact", None)
    if artifact is not None:
        if not isinstance(artifact, Mapping) or "structured_content" not in artifact:
            raise ExampleError("The MCP tool returned an unsupported artifact.")
        result = artifact["structured_content"]
    elif hasattr(result, "content"):
        result = result.content

    if isinstance(result, str):
        result = _parse_json(result)
    if isinstance(result, dict) and "content" in result:
        if result.get("isError") is True:
            raise ExampleError("The MCP tool reported an error; no price was verified.")
        result = result["structuredContent"] if result.get("structuredContent") is not None else result["content"]
    if isinstance(result, list):
        if (len(result) != 1 or not isinstance(result[0], dict)
                or result[0].get("type") != "text" or not isinstance(result[0].get("text"), str)):
            raise ExampleError("The MCP tool returned an unsupported content block.")
        result = _parse_json(result[0]["text"])
    if not isinstance(result, dict):
        raise ExampleError("The MCP result was not a JSON object.")
    if "error" in result or result.get("isError") is True or result.get("success") is False:
        # Do not echo server-supplied errors: they can contain credentials or data.
        raise ExampleError("The MCP tool reported an error. Check access or limits; no automatic retry.")
    return result


def checked_print(result: Any, symbol: str) -> dict[str, Any]:
    receipt = decode_result(result)
    if receipt.get("symbol") != symbol:
        raise ExampleError("The price receipt does not match the requested symbol.")
    price = receipt.get("price")
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0:
        raise ExampleError("The MCP tool did not return an available positive price.")
    if not isinstance(receipt.get("at"), str) or not isinstance(receipt.get("signature"), str):
        raise ExampleError("The MCP tool did not return a signed price receipt.")
    # Return the original object, including priceText, kid, cadence and v2.
    return receipt


def verified_summary(receipt: dict[str, Any], result: Any) -> dict[str, Any]:
    verification = decode_result(result)
    if (verification.get("recordValid") is not True
            or verification.get("valid") is not True
            or verification.get("metadataSigned") is not True
            or verification.get("verificationScope") != "full-record"):
        raise ExampleError("Full-record verification failed. This price and its quality were not accepted.")
    cadence = receipt.get("cadence")
    interval = receipt.get("interval")
    return {
        "symbol": receipt["symbol"],
        "price": receipt["price"],
        "priceText": receipt.get("priceText"),
        "at": receipt["at"],
        "grade": receipt.get("grade"),
        "quality": {
            **{field: receipt.get(field) for field in (
                "engine", "sources", "tier", "confidence", "dispersionBps",
            )},
            "interval": {field: interval.get(field) for field in ("lower", "upper")} if isinstance(interval, dict) else None,
            # Other cadence members, such as updatesLast120s, are unsigned.
            "cadence": {field: cadence.get(field) for field in (
                "band", "calculatedAgeMs", "newestSourceAgeMs", "oldestSourceAgeMs",
                "p50UpdateMs", "p95UpdateMs",
            )} if isinstance(cadence, dict) else None,
        },
        "recordValid": True,
        "verificationScope": "full-record",
        "unsignedContext": {"sample": receipt.get("sample") is True},
        "freshnessAssessed": False,
    }


async def read_and_verify(call: Callable[[str, dict[str, Any]], Awaitable[Any]], symbol: str) -> dict[str, Any]:
    receipt = checked_print(await call("get_index_price", {"symbol": symbol}), symbol)
    # verify_print takes the print fields at the top level, NOT {"print": receipt}.
    return verified_summary(receipt, await call("verify_print", receipt))


def read_and_verify_sync(call: Callable[[str, dict[str, Any]], Any], symbol: str) -> dict[str, Any]:
    receipt = checked_print(call("get_index_price", {"symbol": symbol}), symbol)
    return verified_summary(receipt, call("verify_print", receipt))


def cli(run: Callable[[str, str], Any], *, asynchronous: bool = True) -> None:
    parser = argparse.ArgumentParser(description="Read one Pulse Verity Index price and verify its signed record; no LLM.")
    parser.add_argument("--transport", choices=("stdio", "http"), default="stdio")
    parser.add_argument("--symbol", default="BTC")
    args = parser.parse_args()
    # Avoid exporting graph/tool data through ambient tracing configuration.
    os.environ["LANGSMITH_TRACING"] = "false"
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    os.environ["OTEL_SDK_DISABLED"] = "true"
    os.environ["CREWAI_TELEMETRY_ENABLED"] = "false"
    os.environ["CREWAI_TRACING_ENABLED"] = "false"
    try:
        symbol = validate_symbol(args.symbol)
        if asynchronous:
            # Context entry and cleanup both happen inside this one task.
            async def bounded() -> Any:
                return await asyncio.wait_for(run(args.transport, symbol), timeout=90)
            result = asyncio.run(bounded())
        else:
            result = run(args.transport, symbol)
        print(json.dumps(result, indent=2, allow_nan=False))
    except ExampleError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
    except (Exception, KeyboardInterrupt):
        # Never print arbitrary SDK exceptions, headers, credentials or receipts.
        print("The example could not complete. Check installed dependencies, connectivity and credentials. No verified price was produced.", file=sys.stderr)
        raise SystemExit(1) from None
