"""Real ADK constructors/tool wrapping; only the remote MCP session is fake."""
import asyncio
from unittest.mock import patch

from support import Responses, RuntimeCase, tool_definitions


class AdkRuntimeTest(RuntimeCase):
    def test_real_toolset_context_invocation_and_cleanup(self):
        from google.adk.tools.mcp_tool.mcp_session_manager import MCPSessionManager
        from mcp import types
        import google_adk

        for transport in ("stdio", "http"):
            for mode in ("success", "reject", "tool_error", "missing"):
                with self.subTest(transport=transport, mode=mode):
                    responses, closed = Responses(mode), []

                    class Session:
                        async def list_tools(self):
                            return types.ListToolsResult(tools=tool_definitions(types, missing=mode == "missing"))

                        async def call_tool(self, name, arguments, **kwargs):
                            return responses.mcp_result(types, name, arguments)

                    async def create_session(manager, **kwargs):
                        return Session()

                    original_close = MCPSessionManager.close

                    async def close(manager):
                        await original_close(manager)
                        closed.append(manager)

                    with patch.object(MCPSessionManager, "create_session", create_session), patch.object(MCPSessionManager, "close", close):
                        self.assert_outcome(
                            lambda: asyncio.run(asyncio.wait_for(google_adk.run(transport, "BTC"), 10)),
                            responses,
                        )
                    self.assertEqual(len(closed), 1)
