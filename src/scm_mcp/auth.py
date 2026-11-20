"""OAuth2 client_credentials token management for SCM.

Source: auth/AuthService.yaml — operationId post-auth-v1-oauth2-access_token.
Host is a fixed PANW endpoint, distinct from SCM_BASE_URL (see DESIGN.md
"Base URL 路由规则").
"""

import os
import time

import httpx

AUTH_HOST = "https://auth.apps.paloaltonetworks.com"
TOKEN_PATH = "/auth/v1/oauth2/access_token"
REFRESH_MARGIN_SECONDS = 60


class TokenManager:
    def __init__(self) -> None:
        self._client_id = os.environ["SCM_CLIENT_ID"]
        self._client_secret = os.environ["SCM_CLIENT_SECRET"]
        self._tsg_id = os.environ["SCM_TSG_ID"]
        self._access_token: str | None = None
        self._expires_at: float = 0.0

    async def get_token(self) -> str:
        if self._access_token is None or time.monotonic() >= self._expires_at:
            await self._refresh()
        assert self._access_token is not None
        return self._access_token

    async def _refresh(self) -> None:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                AUTH_HOST + TOKEN_PATH,
                data={
                    "grant_type": "client_credentials",
                    "scope": f"tsg_id:{self._tsg_id}",
                },
                auth=(self._client_id, self._client_secret),
            )
            resp.raise_for_status()
            body = resp.json()

        self._access_token = body["access_token"]
        expires_in = body.get("expires_in", 0)
        self._expires_at = time.monotonic() + expires_in - REFRESH_MARGIN_SECONDS
