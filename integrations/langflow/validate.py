"""Dependency-free checks of the exported graph and its safety boundaries.

Run this file locally. validate_runtime.py separately uses Langflow's real loader
in CI; these structural checks do not claim a successful UI import or live call.
"""

import ast
import copy
import hashlib
import json
from pathlib import Path
import unittest
import uuid

ROOT = Path(__file__).resolve().parent
FLOW = json.loads((ROOT / "pulse-price-sample.json").read_text())
UPSTREAM = json.loads((ROOT / "upstream.json").read_text())


def validate(flow):
    assert flow["name"] == "Pulse Price Sample"
    # The upstream catalog indexes templates by a stable UUID. This is not a user flow ID.
    assert str(uuid.UUID(flow["id"])) == flow["id"]
    assert flow["description"].strip()
    assert flow["mcp_enabled"] is False
    nodes = flow["data"]["nodes"]
    assert len(nodes) == 4
    by_id = {node["id"]: node for node in nodes}
    assert len(by_id) == len(nodes)
    runnable = [node for node in nodes if node["type"] != "noteNode"]
    assert {node["data"]["type"] for node in runnable} == {"ChatInput", "MCPTools", "ChatOutput"}
    for node in runnable:
        component = node["data"]["node"]
        assert node["data"]["id"] == node["id"]
        assert component["tool_mode"] is False
        code = component["template"]["code"]["value"]
        ast.parse(code)
        assert hashlib.sha256(code.encode()).hexdigest() == UPSTREAM["embedded_core_sha256"][node["data"]["type"]]
        for key, field in component["template"].items():
            if isinstance(field, dict) and field.get("password"):
                assert field.get("value") in (None, ""), f"Secret populated: {key}"
    mcp = by_id["MCPTools-pulse"]["data"]["node"]
    template = mcp["template"]
    assert template["mcp_server"]["value"] == {
        "name": "pulse-verity-sample",
        "config": {"command": "npx", "args": ["-y", "pulse-verity@1.3.1"], "env": {"PULSE_API_KEY": ""}},
    }
    assert template["headers"]["value"] == []
    assert template["tool"]["value"] == "get_index_price"
    assert template["tool"]["options"] == ["get_index_price"]
    assert template["verify_ssl"]["value"] is True
    assert template["use_cache"]["value"] is False
    assert template["tool_execution_timeout"]["value"] == 30.0
    assert template["symbol"]["required"] is True
    assert template["symbol"]["input_types"] == ["Message"]
    assert len(mcp["outputs"]) == 1
    assert mcp["outputs"][0]["name"] == "response"
    assert mcp["outputs"][0]["method"] == "build_output"
    assert mcp["outputs"][0]["cache"] is False
    for node_id in ("ChatInput-pulse", "ChatOutput-pulse"):
        assert by_id[node_id]["data"]["node"]["template"]["should_store_message"]["value"] is False
    assert len(flow["data"]["edges"]) == 2
    assert {(e["source"], e["target"]) for e in flow["data"]["edges"]} == {
        ("ChatInput-pulse", "MCPTools-pulse"), ("MCPTools-pulse", "ChatOutput-pulse"),
    }
    for edge in flow["data"]["edges"]:
        source = by_id[edge["source"]]["data"]["node"]
        target = by_id[edge["target"]]["data"]["node"]
        sh, th = edge["data"]["sourceHandle"], edge["data"]["targetHandle"]
        assert json.loads(edge["sourceHandle"].replace("œ", '"')) == sh
        assert json.loads(edge["targetHandle"].replace("œ", '"')) == th
        assert sh["id"] == edge["source"] and th["id"] == edge["target"]
        output = next(o for o in source["outputs"] if o["name"] == sh["name"])
        field = target["template"][th["fieldName"]]
        assert set(output["types"]) & set(field["input_types"])
    assert flow["data"]["edges"][0]["data"]["targetHandle"]["fieldName"] == "symbol"
    note = by_id["note-pulse"]["data"]["node"]["description"]
    assert "does not call `verify_print`" in note
    assert "keep Tool Mode off" in note


class ExportTests(unittest.TestCase):
    def test_export_boundaries(self):
        validate(FLOW)

    def assert_mutation_rejected(self, change):
        flow = copy.deepcopy(FLOW)
        change(flow)
        with self.assertRaises((AssertionError, KeyError, StopIteration)):
            validate(flow)

    def test_rejects_missing_catalog_id(self):
        self.assert_mutation_rejected(lambda f: f.pop("id"))

    def test_rejects_empty_catalog_id(self):
        flow = copy.deepcopy(FLOW)
        flow["id"] = ""
        with self.assertRaises(ValueError):
            validate(flow)

    def test_rejects_write_tool(self):
        self.assert_mutation_rejected(lambda f: f["data"]["nodes"][1]["data"]["node"]["template"]["tool"].update(value="submit_feedback"))

    def test_rejects_tool_mode(self):
        self.assert_mutation_rejected(lambda f: f["data"]["nodes"][1]["data"]["node"].update(tool_mode=True))

    def test_rejects_populated_secret(self):
        self.assert_mutation_rejected(lambda f: f["data"]["nodes"][1]["data"]["node"]["template"]["mcp_server"]["value"]["config"]["env"].update(PULSE_API_KEY="synthetic-secret"))

    def test_rejects_disabled_tls(self):
        self.assert_mutation_rejected(lambda f: f["data"]["nodes"][1]["data"]["node"]["template"]["verify_ssl"].update(value=False))

    def test_rejects_disconnected_graph(self):
        self.assert_mutation_rejected(lambda f: f["data"].update(edges=[]))

    def test_rejects_altered_core_code(self):
        self.assert_mutation_rejected(lambda f: f["data"]["nodes"][1]["data"]["node"]["template"]["code"].update(value="pass\n"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
