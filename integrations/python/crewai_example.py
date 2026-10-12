"""CrewAI MCP tool calls with an explicit allowlist; no Crew or LLM invocation."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from common import (
    MCP_URL, NPM_PACKAGE, TIMEOUT_SECONDS, TOOL_NAMES, cli, hosted_headers,
    key_environment, read_and_verify_sync, select_tools,
)


def run(transport: str, symbol: str) -> dict[str, Any]:
    from crewai_tools import MCPServerAdapter
    from mcp import StdioServerParameters

    connection = (
        {
            "url": MCP_URL, "transport": "streamable-http", "headers": hosted_headers(),
            "timeout": timedelta(seconds=TIMEOUT_SECONDS),
            "sse_read_timeout": timedelta(seconds=TIMEOUT_SECONDS),
        }
        if transport == "http" else
        StdioServerParameters(command="npx", args=["-y", NPM_PACKAGE], env=key_environment())
    )
    # The adapter owns its background MCP thread and closes it on every exit.
    with MCPServerAdapter(connection, *TOOL_NAMES, connect_timeout=TIMEOUT_SECONDS) as discovered:
        tools = select_tools(discovered)

        def invoke(name: str, arguments: dict[str, Any]) -> Any:
            return tools[name].run(**arguments)

        return read_and_verify_sync(invoke, symbol)


if __name__ == "__main__":
    cli(run, asynchronous=False)
