"""Real MCPAdapter, StructuredTool and compiled LangGraph; fake client I/O."""
import asyncio
from unittest.mock import patch

from support import Responses, RuntimeCase, tool_definitions


class LangchainRuntimeTest(RuntimeCase):
    def test_real_adapter_tool_messages_graph_and_cleanup(self):
        from fastmcp import Client
        from fastmcp.client.client import CallToolResult
        from mcp import types
        import langchain_graph

        for transport in ("stdio", "http"):
            for mode in ("success", "reject", "tool_error", "missing"):
                with self.subTest(transport=transport, mode=mode):
                    responses, contexts = Responses(mode), []
                    depth = 0

                    async def enter(client):
                        nonlocal depth
                        depth += 1
                        contexts.append("enter")
                        return client

                    async def leave(client, *args):
                        nonlocal depth
                        depth -= 1
                        contexts.append("exit")

                    async def list_tools(client, **kwargs):
                        self.assertGreater(depth, 0)
                        return tool_definitions(types, missing=mode == "missing")

                    async def call_tool(client, name, arguments, **kwargs):
                        self.assertGreater(depth, 0)
                        payload = responses.payload(name, arguments)
                        return CallToolResult(content=[], structured_content=payload, meta=None, is_error=mode == "tool_error")

                    with patch.object(Client, "__aenter__", enter), patch.object(Client, "__aexit__", leave), patch.object(Client, "list_tools", list_tools), patch.object(Client, "call_tool", call_tool):
                        self.assert_outcome(
                            lambda: asyncio.run(asyncio.wait_for(langchain_graph.run(transport, "BTC"), 10)),
                            responses,
                        )
                    self.assertEqual(depth, 0)
                    self.assertEqual(contexts[0], "enter")
                    self.assertEqual(contexts[-1], "exit")
