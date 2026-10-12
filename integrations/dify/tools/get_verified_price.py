from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from lib.verity_mcp import VerityError, VerityMcp, normalize_symbol


class GetVerifiedPriceTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        try:
            symbol = normalize_symbol(tool_parameters.get("symbol"))
            with VerityMcp(self.runtime.credentials.get("pulse_api_key")) as client:
                result = client.get_verified_price(symbol)
        except VerityError as error:
            result = error.result()
        except Exception:
            result = VerityError("UNAVAILABLE").result()
        yield self.create_json_message(result)
        for name, value in result.items():
            yield self.create_variable_message(name, value)
