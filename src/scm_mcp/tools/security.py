"""Security tools — source: config/sase/security/security-services-R2-2026.yaml.

Covers the DESIGN.md section 2 scope: security-rules (full CRUD + move) and
List for the highest-frequency profile types.
"""

from scm_mcp.client import ScmClient, drop_none

PATH_PREFIX = "/config/security/v1"


def _list_params(
    name: str | None,
    folder: str | None,
    snippet: str | None,
    device: str | None,
    offset: int | None,
    limit: int | None,
) -> dict:
    return drop_none(
        {
            "name": name,
            "folder": folder,
            "snippet": snippet,
            "device": device,
            "offset": offset,
            "limit": limit,
        }
    )


# --- Security Rules ---

async def list_security_rules(
    client: ScmClient,
    name: str | None = None,
    position: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    if position is not None:
        params["position"] = position
    return await client.request_config("GET", PATH_PREFIX, "/security-rules", params=params)


async def create_security_rule(
    client: ScmClient, body: dict, position: str | None = None
) -> dict:
    params = drop_none({"position": position})
    return await client.request_config(
        "POST", PATH_PREFIX, "/security-rules", params=params, json=body
    )


async def get_security_rule(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/security-rules/{id}")


async def update_security_rule(client: ScmClient, id: str, body: dict) -> dict:
    return await client.request_config("PUT", PATH_PREFIX, f"/security-rules/{id}", json=body)


async def delete_security_rule(client: ScmClient, id: str) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, f"/security-rules/{id}")


async def move_security_rule(client: ScmClient, id: str, body: dict) -> dict:
    """body: {destination: top|bottom|before|after (required), rulebase: pre|post (required),
    destination_rule?: <uuid, required if destination is before/after>}"""
    return await client.request_config(
        "POST", PATH_PREFIX, f"/security-rules/{id}:move", json=body
    )


# --- Profile Lists (highest-frequency types) ---

async def list_anti_spyware_profiles(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config(
        "GET", PATH_PREFIX, "/anti-spyware-profiles", params=params
    )


async def create_anti_spyware_profile(client: ScmClient, body: dict) -> dict:
    return await client.request_config(
        "POST", PATH_PREFIX, "/anti-spyware-profiles", json=body
    )


async def list_vulnerability_protection_profiles(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config(
        "GET", PATH_PREFIX, "/vulnerability-protection-profiles", params=params
    )


async def list_url_access_profiles(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config(
        "GET", PATH_PREFIX, "/url-access-profiles", params=params
    )


async def list_decryption_rules(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/decryption-rules", params=params)


async def list_dos_protection_rules(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config(
        "GET", PATH_PREFIX, "/dos-protection-rules", params=params
    )


# --- Custom URL Categories ---
# operationId ListURLCategories / GetURLCategoriesByID (security-services-R2-2026.yaml).
# The response `list` array holds the category members (domains/URLs for a URL List,
# or built-in category names for a Category Match). This is what lets you expand a
# custom URL category referenced in a security rule's `category` field — e.g. confirm
# whether a site is a hidden member of an "AI-Site"-style category despite its name.

async def list_url_categories(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/url-categories", params=params)


async def get_url_category(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/url-categories/{id}")
