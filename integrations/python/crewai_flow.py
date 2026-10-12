"""A deterministic CrewAI Flow: validate input, read and verify, return output."""
from __future__ import annotations

from typing import Any, Literal

from common import ExampleError, cli, validate_symbol
from crewai_example import run as read_verified_price


def create_flow() -> Any:
    # Import after the CLI has disabled ambient telemetry and tracing.
    from crewai.flow.flow import Flow, listen, start
    from pydantic import BaseModel

    class PriceState(BaseModel):
        symbol: str = "BTC"
        transport: Literal["stdio", "http"] = "stdio"
        result: dict[str, Any] | None = None

    class VerifiedPriceFlow(Flow[PriceState]):
        @start()
        def validate_input(self) -> str:
            self.state.result = None
            self.state.symbol = validate_symbol(self.state.symbol)
            return self.state.symbol

        @listen(validate_input)
        def read_and_verify(self, symbol: str) -> dict[str, Any]:
            # The adapter closes before this method returns or raises. Failed
            # verification never populates the Flow's result state.
            try:
                result = read_verified_price(self.state.transport, symbol)
            except ExampleError:
                raise
            except Exception:
                # Flow runtimes may log listener exceptions before the outer
                # CLI catches them. Do not hand them arbitrary SDK error text.
                raise ExampleError("The MCP request failed; no verified price was produced.") from None
            self.state.result = result
            return result

    return VerifiedPriceFlow(tracing=False, suppress_flow_events=True)


def run(transport: str, symbol: str) -> dict[str, Any]:
    return create_flow().kickoff(inputs={"transport": transport, "symbol": symbol})


if __name__ == "__main__":
    cli(run, asynchronous=False)
