"""Discover and invoke Google ADK MCP tools without starting a model or server."""
from __future__ import annotations

from typing import Any
from uuid import uuid4

from common import (
    MCP_URL, NPM_PACKAGE, TIMEOUT_SECONDS, TOOL_NAMES, cli, hosted_headers,
    key_environment, read_and_verify, select_tools,
)


async def run(transport: str, symbol: str) -> dict[str, Any]:
    from google.adk.agents.invocation_context import InvocationContext
    from google.adk.sessions import InMemorySessionService
    from google.adk.tools.mcp_tool import McpToolset
    from google.adk.tools.mcp_tool.mcp_session_manager import (
        StdioConnectionParams, StreamableHTTPConnectionParams,
    )
    from google.adk.tools.tool_context import ToolContext
    from mcp import StdioServerParameters

    connection = (
        StreamableHTTPConnectionParams(
            url=MCP_URL, headers=hosted_headers(),
            timeout=TIMEOUT_SECONDS, sse_read_timeout=TIMEOUT_SECONDS,
        )
        if transport == "http" else
        StdioConnectionParams(
            server_params=StdioServerParameters(
                command="npx", args=["-y", NPM_PACKAGE], env=key_environment(),
            ),
            timeout=TIMEOUT_SECONDS,
        )
    )
    toolset = McpToolset(connection_params=connection, tool_filter=list(TOOL_NAMES))
    try:
        tools = select_tools(await toolset.get_tools())
        # A synthetic in-memory invocation supplies the ADK tool context. No LLM
        # agent, cloud account, GOOGLE_API_KEY, or model runner is needed.
        sessions = InMemorySessionService()
        session = await sessions.create_session(app_name="verity_example", user_id="example_user")
        invocation = InvocationContext(
            invocation_id=str(uuid4()), session_service=sessions, session=session,
        )

        async def invoke(name: str, arguments: dict[str, Any]) -> Any:
            context = ToolContext(invocation, function_call_id=f"verity-{name}")
            return await tools[name].run_async(args=arguments, tool_context=context)

        return await read_and_verify(invoke, symbol)
    finally:
        await toolset.close()


if __name__ == "__main__":
    cli(run)
