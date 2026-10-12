from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from lib.verity_mcp import VerityError, VerityMcp


class PulseVerityProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            with VerityMcp(credentials.get("pulse_api_key")) as client:
                # Initialization checks bearer access without reading a price.
                client.initialize()
        except VerityError as error:
            raise ToolProviderCredentialValidationError(error.message) from None
        except Exception:
            # SDK logs must never receive raw transport exceptions or credentials.
            raise ToolProviderCredentialValidationError(
                "Pulse credential validation could not complete. Check the service and try again manually."
            ) from None
