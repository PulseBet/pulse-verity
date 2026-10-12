"""LangChain MCP tools in a deterministic two-node LangGraph; no model call."""
from __future__ import annotations

from typing import Any, TypedDict

from common import (
    MCP_URL, NPM_PACKAGE, TIMEOUT_SECONDS, checked_print, cli, hosted_headers,
    key_environment, select_tools, verified_summary,
)


class PriceState(TypedDict, total=False):
    symbol: str
    receipt: dict[str, Any]
    result: dict[str, Any]


async def run(transport: str, symbol: str) -> dict[str, Any]:
    from fastmcp import Client
    from fastmcp.client.transports import StdioTransport, StreamableHttpTransport
    from langchain.mcp import MCPAdapter
    from langgraph.graph import END, START, StateGraph

    connection = (
        StreamableHttpTransport(url=MCP_URL, headers=hosted_headers())
        if transport == "http" else
        StdioTransport(command="npx", args=["-y", NPM_PACKAGE], env=key_environment(), keep_alive=False)
    )
    async with MCPAdapter(Client(connection, timeout=TIMEOUT_SECONDS)) as adapter:
        # Discovery may list other server tools. Only these two leave this boundary.
        tools = select_tools(await adapter.list_tools())

        async def invoke(name: str, arguments: dict[str, Any]) -> Any:
            # A ToolCall envelope retains ToolMessage status and structured artifact.
            return await tools[name].ainvoke({
                "name": name, "args": arguments, "id": f"verity-{name}", "type": "tool_call",
            })

        async def read_price(state: PriceState) -> dict[str, Any]:
            response = await invoke("get_index_price", {"symbol": state["symbol"]})
            return {"receipt": checked_print(response, state["symbol"])}

        async def verify_record(state: PriceState) -> dict[str, Any]:
            receipt = state["receipt"]
            response = await invoke("verify_print", receipt)
            return {"result": verified_summary(receipt, response)}

        graph = StateGraph(PriceState)
        graph.add_node("read_price", read_price)
        graph.add_node("verify_record", verify_record)
        graph.add_edge(START, "read_price")
        graph.add_edge("read_price", "verify_record")
        graph.add_edge("verify_record", END)
        state = await graph.compile().ainvoke({"symbol": symbol})
        return state["result"]


if __name__ == "__main__":
    cli(run)
