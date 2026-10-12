"""Check installed entrypoint wiring with a fake Flow; run with Python -I."""
from contextlib import redirect_stderr, redirect_stdout
from importlib.metadata import distribution
import io
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch


def deny_external_io(event, args):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto", "subprocess.Popen"}:
        raise AssertionError("Package checks must not access the network or launch a process")


sys.addaudithook(deny_external_io)
dist = distribution("pulse-verity-crewai-flow")
scripts = {entry.name: entry for entry in dist.entry_points if entry.group == "console_scripts"}
assert {"kickoff", "run_crew"} <= set(scripts), "Missing CrewAI console entrypoint"
assert set(dist.requires) == {"crewai-tools[mcp]==1.15.27", "mcpadapt==0.1.20"}

import crewai_flow  # noqa: E402
from common import ExampleError  # noqa: E402

# -I prevents a checkout import from hiding omitted wheel modules.
assert Path(crewai_flow.__file__).resolve() == Path(dist.locate_file("crewai_flow.py")).resolve()
assert scripts["kickoff"].load() is crewai_flow.kickoff
assert scripts["run_crew"].load() is crewai_flow.kickoff


def fake_kickoff(*, inputs):
    assert inputs == {"symbol": "BTC", "transport": "stdio"}
    assert os.environ["CREWAI_TRACING_ENABLED"] == "false"
    assert os.environ["OTEL_SDK_DISABLED"] == "true"
    return {"symbol": "BTC", "recordValid": True, "freshnessAssessed": False}


output = io.StringIO()
with patch.object(crewai_flow, "create_flow", return_value=SimpleNamespace(kickoff=fake_kickoff)), patch.object(sys, "argv", ["kickoff", "--symbol", "btc"]), redirect_stdout(output):
    scripts["kickoff"].load()()
assert json.loads(output.getvalue()) == {"symbol": "BTC", "recordValid": True, "freshnessAssessed": False}

errors = io.StringIO()
with patch.object(crewai_flow, "create_flow", side_effect=ExampleError("Synthetic verification failure")), patch.object(sys, "argv", ["kickoff"]), redirect_stderr(errors):
    try:
        scripts["kickoff"].load()()
    except SystemExit as error:
        assert error.code == 1
    else:
        raise AssertionError("Failed verification must return a nonzero exit code")
assert errors.getvalue().strip() == "Synthetic verification failure"
print("Installed CrewAI entrypoints: success and failure paths passed with a mocked Flow.")
