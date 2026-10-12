"""CI-only: load the real Langflow graph, then exercise MCP with synthetic results.

Requires langflow==1.12.5. Starts no server, subprocess, or model. Never calls the
live Pulse service. A successful run establishes graph loading and mocked MCP
execution, not a rendered UI import, upstream acceptance, or live connectivity.
"""

import asyncio
import copy
import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def deny_external_io(event, args):
    if event in {
        "socket.connect", "socket.getaddrinfo", "socket.sendto",
        "socket.gethostbyname", "socket.gethostbyaddr", "socket.getnameinfo",
        "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn",
        "os.fork", "os.forkpty", "pty.spawn",
    }:
        raise AssertionError(f"External I/O disabled during Langflow validation: {event}")


# Install before importing Langflow, its telemetry, or any other third-party
# dependency. AF_UNIX socketpair remains available to asyncio's event loop.
sys.addaudithook(deny_external_io)
os.environ.update({
    "DO_NOT_TRACK": "true", "LANGFLOW_DO_NOT_TRACK": "true",
    "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false",
    "OTEL_SDK_DISABLED": "true",
})

from validate import FLOW, validate

from langflow.services.database.models.flow.model import FlowCreate
from lfx.graph import Graph
from lfx.interface.initialize.loading import get_params
from lfx.schema.message import Message
from mcp.types import CallToolResult, TextContent
from pydantic import BaseModel


class PriceInput(BaseModel):
    symbol: str


async def check():
    validate(FLOW)
    imported = FlowCreate.model_validate(copy.deepcopy(FLOW))
    # This is the real graph loader, including component constructors and edges.
    graph = Graph.from_payload(imported.data, emit_extension_events=False)
    assert set(graph.vertex_map) == {"ChatInput-pulse", "MCPTools-pulse", "ChatOutput-pulse"}
    vertex = graph.vertex_map["MCPTools-pulse"]
    component = vertex.custom_component
    assert component is not None
    # Graph construction stores saved values in _parameters. Langflow applies
    # them with set_attributes only in loading.build_component, just before
    # execution. Bind the actual imported parameters at that same boundary;
    # asserting against constructor defaults would test the wrong phase.
    params = get_params(vertex.params)
    params.pop("code", None)
    assert params["tool"] == "get_index_price"
    expected_config = FLOW["data"]["nodes"][1]["data"]["node"]["template"]["mcp_server"]["value"]
    assert params["mcp_server"] == expected_config
    assert params["symbol"] is graph.vertex_map["ChatInput-pulse"]
    # Resolve only the upstream edge to a synthetic ChatInput Message; every
    # other runtime parameter comes from the actual exported graph.
    params["symbol"] = Message(text="BTC")
    component.set_attributes(params)
    assert component.tool == "get_index_price"
    assert component.mcp_server == expected_config
    assert component.get_outputs_map()["response"].method == "build_output"
    assert "component_as_tool" not in component.get_outputs_map()
    observation = {"symbol": "BTC", "priceText": "123.4500", "at": "2026-01-01T00:00:00Z", "grade": "synthetic"}
    call = AsyncMock(return_value=CallToolResult(content=[TextContent(type="text", text=json.dumps(observation))]))
    tool = SimpleNamespace(name="get_index_price", args_schema=PriceInput, coroutine=call)

    async def mock_discovery(*args, **kwargs):
        component._tool_cache = {"get_index_price": tool}
        return [tool], component.mcp_server

    with patch.object(component, "update_tool_list", mock_discovery):
        result = await component.build_output()
        call.assert_awaited_once_with(symbol="BTC")
        assert result.to_dict(orient="records") == [observation]
        for message in ("quota exceeded", "authentication failed", "invalid symbol"):
            call.reset_mock()
            call.return_value = CallToolResult(isError=True, content=[TextContent(type="text", text=message)])
            try:
                await component.build_output()
            except ValueError as error:
                assert message in str(error)
            else:
                raise AssertionError("MCP failure was converted to successful data")
            call.assert_awaited_once_with(symbol="BTC")
    print("Langflow 1.12.5 graph import and mocked read/error paths passed; no live service/model called.")


if __name__ == "__main__":
    # Catch accidental outbound calls or MCP process launch if a future import or
    # constructor changes behavior. The mocked execution must stay fully offline.
    with patch("socket.socket.connect", side_effect=AssertionError("Network disabled during validation")), \
         patch("socket.socket.connect_ex", side_effect=AssertionError("Network disabled during validation")), \
         patch("subprocess.Popen", side_effect=AssertionError("Subprocesses disabled during validation")):
        asyncio.run(check())
