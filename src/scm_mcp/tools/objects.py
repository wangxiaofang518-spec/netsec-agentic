"""Objects tools — source: config/sase/objects/objects-june.yaml.

Covers the DESIGN.md section 1 scope: addresses, address-groups,
applications, application-groups, services, service-groups, tags.
"""

from scm_mcp.client import ScmClient, drop_none

PATH_PREFIX = "/config/objects/v1"


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


# --- Addresses ---

async def list_addresses(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/addresses", params=params)


async def create_address(client: ScmClient, body: dict) -> dict:
    return await client.request_config("POST", PATH_PREFIX, "/addresses", json=body)


async def get_address(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/addresses/{id}")


async def update_address(client: ScmClient, id: str, body: dict) -> dict:
    return await client.request_config("PUT", PATH_PREFIX, f"/addresses/{id}", json=body)


async def delete_address(client: ScmClient, id: str) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, f"/addresses/{id}")


# --- Address Groups ---

async def list_address_groups(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/address-groups", params=params)


async def create_address_group(client: ScmClient, body: dict) -> dict:
    return await client.request_config("POST", PATH_PREFIX, "/address-groups", json=body)


async def get_address_group(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/address-groups/{id}")


async def update_address_group(client: ScmClient, id: str, body: dict) -> dict:
    return await client.request_config("PUT", PATH_PREFIX, f"/address-groups/{id}", json=body)


async def delete_address_group(client: ScmClient, id: str) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, f"/address-groups/{id}")


# --- Applications ---

async def list_applications(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/applications", params=params)


async def create_application(client: ScmClient, body: dict) -> dict:
    return await client.request_config("POST", PATH_PREFIX, "/applications", json=body)


async def get_application(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/applications/{id}")


async def update_application(client: ScmClient, id: str, body: dict) -> dict:
    return await client.request_config("PUT", PATH_PREFIX, f"/applications/{id}", json=body)


async def delete_application(client: ScmClient, id: str) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, f"/applications/{id}")


# --- Application Groups ---

async def list_application_groups(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/application-groups", params=params)


async def create_application_group(client: ScmClient, body: dict) -> dict:
    return await client.request_config("POST", PATH_PREFIX, "/application-groups", json=body)


# --- Services ---

async def list_services(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/services", params=params)


async def create_service(client: ScmClient, body: dict) -> dict:
    return await client.request_config("POST", PATH_PREFIX, "/services", json=body)


async def get_service(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/services/{id}")


async def update_service(client: ScmClient, id: str, body: dict) -> dict:
    return await client.request_config("PUT", PATH_PREFIX, f"/services/{id}", json=body)


async def delete_service(client: ScmClient, id: str) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, f"/services/{id}")


# --- Service Groups ---

async def list_service_groups(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/service-groups", params=params)


# --- Tags ---

async def list_tags(
    client: ScmClient,
    name: str | None = None,
    folder: str | None = None,
    snippet: str | None = None,
    device: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _list_params(name, folder, snippet, device, offset, limit)
    return await client.request_config("GET", PATH_PREFIX, "/tags", params=params)


async def create_tag(client: ScmClient, body: dict) -> dict:
    return await client.request_config("POST", PATH_PREFIX, "/tags", json=body)


async def delete_tag(client: ScmClient, id: str) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, f"/tags/{id}")


# --- External Dynamic Lists ---

async def list_external_dynamic_lists(
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
        "GET", PATH_PREFIX, "/external-dynamic-lists", params=params
    )
