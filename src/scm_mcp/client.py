"""HTTP client wrapper for SCM REST API calls.

Two URL construction modes exist because SCM's OpenAPI specs declare
different servers[0].url per API family (see DESIGN.md "Base URL 路由规则"):

- Config APIs (objects/security/deployment/operations): SCM_BASE_URL + path_prefix + path
- IAM/Tenancy/Subscription APIs: IAM_HOST + path (no SCM_BASE_URL, no prefix)
"""

import os

import httpx

from scm_mcp.auth import TokenManager

DEFAULT_SCM_BASE_URL = "https://api.strata.paloaltonetworks.com"
IAM_HOST = "https://api.sase.paloaltonetworks.com"


def drop_none(params: dict) -> dict:
    """Drop None values so unset optional query params aren't sent at all."""
    return {k: v for k, v in params.items() if v is not None}


class ScmClient:
    def __init__(self) -> None:
        self._base_url = os.environ.get("SCM_BASE_URL", DEFAULT_SCM_BASE_URL)
        self._token_manager = TokenManager()
        self._http = httpx.AsyncClient(timeout=30.0)

    async def request_config(
        self, method: str, path_prefix: str, path: str, **kwargs
    ) -> dict:
        """Call a Config API (objects/security/deployment/operations) endpoint."""
        return await self._request(method, self._base_url + path_prefix + path, **kwargs)

    async def request_iam(self, method: str, path: str, **kwargs) -> dict:
        """Call an IAM/Tenancy/Subscription endpoint (fixed IAM_HOST, no SCM_BASE_URL)."""
        return await self._request(method, IAM_HOST + path, **kwargs)

    async def _request(self, method: str, url: str, **kwargs) -> dict:
        try:
            token = await self._token_manager.get_token()
            headers = kwargs.pop("headers", {})
            headers["Authorization"] = f"Bearer {token}"

            resp = await self._http.request(method, url, headers=headers, **kwargs)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            return {"error": str(e.response.status_code), "detail": e.response.text}
        except httpx.RequestError as e:
            return {"error": "network_error", "detail": str(e)}

        if not resp.content:
            return {}
        return resp.json()

    async def aclose(self) -> None:
        await self._http.aclose()
