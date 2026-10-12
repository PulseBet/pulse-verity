"""Real CrewAI tool wrappers, adapter thread and Flow; fake MCP session only."""
from contextlib import asynccontextmanager
from unittest.mock import patch

from support import ExampleError, Responses, RuntimeCase, tool_definitions


class CrewRuntimeTest(RuntimeCase):
    def test_real_tools_thread_and_flow_cleanup(self):
        from mcp import types
        from mcpadapt.core import MCPAdapt
        import crewai_example
        import crewai_flow

        for entrypoint in (crewai_example.run, crewai_flow.run):
            for transport in ("stdio", "http"):
                for mode in ("success", "reject", "tool_error", "missing"):
                    with self.subTest(entrypoint=entrypoint.__module__, transport=transport, mode=mode):
                        responses, lifecycle, adapters = Responses(mode), [], []

                        class Session:
                            async def list_tools(self):
                                return types.ListToolsResult(tools=tool_definitions(types, missing=mode == "missing"))

                            async def call_tool(self, name, arguments):
                                return responses.mcp_result(types, name, arguments)

                        @asynccontextmanager
                        async def mcptools(*args, **kwargs):
                            lifecycle.append("open")
                            try:
                                yield Session(), tool_definitions(types, missing=mode == "missing")
                            finally:
                                lifecycle.append("close")

                        original_init = MCPAdapt.__init__

                        def initialize(adapter, *args, **kwargs):
                            original_init(adapter, *args, **kwargs)
                            adapters.append(adapter)

                        with patch("mcpadapt.core.mcptools", mcptools), patch.object(MCPAdapt, "__init__", initialize):
                            self.assert_outcome(lambda: entrypoint(transport, "BTC"), responses)
                        self.assertEqual(lifecycle, ["open", "close"])
                        self.assertEqual(len(adapters), 1)
                        self.assertFalse(adapters[0].thread.is_alive())
                        self.assertTrue(adapters[0].loop.is_closed())

    def test_flow_invalid_input_never_opens_adapter(self):
        import crewai_flow

        flow = crewai_flow.create_flow()
        with patch("crewai_flow.read_verified_price", side_effect=AssertionError("No MCP call expected")):
            with self.assertRaises(ExampleError):
                flow.kickoff(inputs={"symbol": "BTC/USDT", "transport": "stdio"})
        self.assertIsNone(flow.state.result)

    def test_flow_failure_does_not_publish_result_state(self):
        import crewai_flow

        flow = crewai_flow.create_flow()
        with patch("crewai_flow.read_verified_price", side_effect=ExampleError("Synthetic failure")):
            with self.assertRaises(ExampleError):
                flow.kickoff(inputs={"symbol": "BTC", "transport": "stdio"})
        self.assertIsNone(flow.state.result)

    def test_flow_suppresses_arbitrary_sdk_exception_before_listener_logging(self):
        import crewai_flow

        flow = crewai_flow.create_flow()
        with patch("crewai_flow.read_verified_price", side_effect=RuntimeError("synthetic-private-header")):
            with self.assertRaises(ExampleError) as caught:
                flow.kickoff(inputs={"symbol": "BTC", "transport": "stdio"})
        self.assertNotIn("synthetic-private-header", str(caught.exception))
        self.assertIsNone(flow.state.result)
