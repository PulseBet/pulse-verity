"""Framework orchestration tests using signature-shaped doubles, no SDK installs.

These prove our call order, configuration, result handling and cleanup. They do
not claim compatibility execution against installed SDKs or live services.
"""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import crewai_example
import google_adk
import langchain_graph
from common import ExampleError, MCP_URL, NPM_PACKAGE, TOOL_NAMES
from test_common import RECEIPT, VERIFIED


def packages(exports):
    modules = {}
    for name, values in exports.items():
        parts = name.split(".")
        for i in range(1, len(parts) + 1):
            path = ".".join(parts[:i])
            if path not in modules:
                modules[path] = ModuleType(path)
                modules[path].__path__ = []
        for key, value in values.items():
            setattr(modules[name], key, value)
    return modules


class FrameworkTest(unittest.TestCase):
    def fixtures(self, framework, *, reject=False):
        calls, configuration, lifecycle = [], {}, []

        def payload(name, args):
            self.assertIn(name, TOOL_NAMES)
            calls.append((name, deepcopy(args)))
            if name == "get_index_price":
                return deepcopy(RECEIPT)
            return {**VERIFIED, "recordValid": False} if reject else deepcopy(VERIFIED)

        class Tool:
            def __init__(self, name):
                self.name = name

            async def ainvoke(self, envelope):
                assert envelope["type"] == "tool_call"
                assert envelope["name"] == self.name
                return SimpleNamespace(status="success", artifact={"structured_content": payload(self.name, envelope["args"])})

            async def run_async(self, *, args, tool_context):
                assert tool_context.function_call_id == f"verity-{self.name}"
                return {"isError": False, "structuredContent": payload(self.name, args), "content": []}

            def run(self, **arguments):
                return json.dumps(payload(self.name, arguments))

        discovered = [Tool(name) for name in (*TOOL_NAMES, "submit_verity_feedback")]

        class Connection:
            def __init__(self, **kwargs):
                configuration.update(kwargs)

        class Client:
            def __init__(self, connection, *, timeout):
                self.connection = connection
                assert timeout == 30

        class Adapter:
            def __init__(self, client):
                self.client = client

            async def __aenter__(self):
                lifecycle.append("open")
                return self

            async def __aexit__(self, *args):
                lifecycle.append("close")

            async def list_tools(self):
                return discovered

        class Graph:
            def __init__(self, state):
                self.nodes, self.edges = {}, {}

            def add_node(self, name, function):
                self.nodes[name] = function

            def add_edge(self, source, destination):
                self.edges[source] = destination

            def compile(self):
                return self

            async def ainvoke(self, state):
                current = "START"
                for _ in range(3):
                    current = self.edges[current]
                    if current == "END":
                        return state
                    state.update(await self.nodes[current](state))
                raise AssertionError("The example graph did not terminate")

        class Toolset:
            def __init__(self, *, connection_params, tool_filter):
                assert tool_filter == list(TOOL_NAMES)
                lifecycle.append("open")

            async def get_tools(self):
                return discovered

            async def close(self):
                lifecycle.append("close")

        class Sessions:
            async def create_session(self, *, app_name, user_id):
                return SimpleNamespace(state={}, app_name=app_name, user_id=user_id)

        class Context:
            def __init__(self, invocation, *, function_call_id):
                self.function_call_id = function_call_id

        class CrewAdapter:
            def __init__(self, connection, *names, connect_timeout):
                assert names == TOOL_NAMES
                assert connect_timeout == 30
                if isinstance(connection, dict):
                    configuration.update(connection)

            def __enter__(self):
                lifecycle.append("open")
                return discovered

            def __exit__(self, *args):
                lifecycle.append("close")

        exports = {
            "fastmcp": {"Client": Client},
            "fastmcp.client.transports": {"StdioTransport": Connection, "StreamableHttpTransport": Connection},
            "langchain.mcp": {"MCPAdapter": Adapter},
            "langgraph.graph": {"START": "START", "END": "END", "StateGraph": Graph},
            "google.adk.agents.invocation_context": {"InvocationContext": SimpleNamespace},
            "google.adk.sessions": {"InMemorySessionService": Sessions},
            "google.adk.tools.mcp_tool": {"McpToolset": Toolset},
            "google.adk.tools.mcp_tool.mcp_session_manager": {"StdioConnectionParams": Connection, "StreamableHTTPConnectionParams": Connection},
            "google.adk.tools.tool_context": {"ToolContext": Context},
            "mcp": {"StdioServerParameters": Connection},
            "crewai_tools": {"MCPServerAdapter": CrewAdapter},
        }
        return packages(exports), calls, configuration, lifecycle

    def execute(self, module, transport, reject=False):
        modules, calls, configuration, lifecycle = self.fixtures(module, reject=reject)
        with patch.dict(sys.modules, modules), patch.dict("os.environ", {"PULSE_API_KEY": "synthetic-key"}, clear=True):
            if reject:
                with self.assertRaises(ExampleError):
                    self.invoke(module, transport)
            else:
                result = self.invoke(module, transport)
                self.assertTrue(result["recordValid"])
                self.assertEqual(result["quality"]["confidence"], 0.5)
        self.assertEqual(calls, [("get_index_price", {"symbol": "BTC"}), ("verify_print", RECEIPT)])
        self.assertEqual(lifecycle, ["open", "close"])
        if transport == "http":
            self.assertEqual(configuration["url"], MCP_URL)
            self.assertEqual(configuration["headers"], {"Authorization": "Bearer synthetic-key"})
        else:
            self.assertEqual(configuration["command"], "npx")
            self.assertEqual(configuration["args"], ["-y", NPM_PACKAGE])
            self.assertEqual(configuration["env"], {"PULSE_API_KEY": "synthetic-key"})

    @staticmethod
    def invoke(module, transport):
        if module is crewai_example:
            return module.run(transport, "BTC")
        return asyncio.run(asyncio.wait_for(module.run(transport, "BTC"), timeout=1))

    def test_langchain_graph_configuration_sequence_and_cleanup(self):
        for transport in ("stdio", "http"):
            with self.subTest(transport=transport):
                self.execute(langchain_graph, transport)

    def test_google_adk_configuration_sequence_and_cleanup(self):
        for transport in ("stdio", "http"):
            with self.subTest(transport=transport):
                self.execute(google_adk, transport)

    def test_crewai_configuration_sequence_and_cleanup(self):
        for transport in ("stdio", "http"):
            with self.subTest(transport=transport):
                self.execute(crewai_example, transport)

    def test_every_framework_closes_after_verification_failure(self):
        for module in (langchain_graph, google_adk, crewai_example):
            with self.subTest(framework=module.__name__):
                self.execute(module, "stdio", reject=True)


if __name__ == "__main__":
    unittest.main()
