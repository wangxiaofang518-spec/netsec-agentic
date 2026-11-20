"""Deployment tools — source: config/sase/deployment/deployment-services-june.yaml.

Covers the DESIGN.md section 3 scope: remote-networks, service-connections,
locations, bgp-routing, bandwidth-allocations, shared-infrastructure-settings,
sites.

Note: the "folder" query param on remote-networks/sites (enum: "Remote
Networks") and service-connections/service-connection-groups/
traffic-steering-rules (enum: "Service Connections") is `required: true` in
the YAML but has a fixed `default`. We keep it optional in the tool
signature and let ScmClient fall back to the YAML-declared default so
callers don't have to pass a value that can only ever be one thing.
"""

from scm_mcp.client import ScmClient, drop_none

PATH_PREFIX = "/config/deployment/v1"

FOLDER_REMOTE_NETWORKS_DEFAULT = "Remote Networks"
FOLDER_SERVICE_CONNECTIONS_DEFAULT = "Service Connections"


# --- Remote Networks ---

async def list_remote_networks(
    client: ScmClient,
    folder: str = FOLDER_REMOTE_NETWORKS_DEFAULT,
    name: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = drop_none({"folder": folder, "name": name, "offset": offset, "limit": limit})
    return await client.request_config("GET", PATH_PREFIX, "/remote-networks", params=params)


async def create_remote_network(client: ScmClient, body: dict) -> dict:
    return await client.request_config("POST", PATH_PREFIX, "/remote-networks", json=body)


async def get_remote_network(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/remote-networks/{id}")


async def update_remote_network(client: ScmClient, id: str, body: dict) -> dict:
    return await client.request_config(
        "PUT", PATH_PREFIX, f"/remote-networks/{id}", json=body
    )


async def delete_remote_network(client: ScmClient, id: str) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, f"/remote-networks/{id}")


# --- Service Connections ---

async def list_service_connections(
    client: ScmClient,
    folder: str = FOLDER_SERVICE_CONNECTIONS_DEFAULT,
    name: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = drop_none({"folder": folder, "name": name, "offset": offset, "limit": limit})
    return await client.request_config(
        "GET", PATH_PREFIX, "/service-connections", params=params
    )


async def create_service_connection(client: ScmClient, body: dict) -> dict:
    return await client.request_config(
        "POST", PATH_PREFIX, "/service-connections", json=body
    )


# --- Locations ---

async def list_locations(client: ScmClient) -> dict:
    return await client.request_config("GET", PATH_PREFIX, "/locations")


# --- BGP Routing ---

async def get_bgp_routing(client: ScmClient) -> dict:
    return await client.request_config("GET", PATH_PREFIX, "/bgp-routing")


async def update_bgp_routing(client: ScmClient, body: dict) -> dict:
    return await client.request_config("PUT", PATH_PREFIX, "/bgp-routing", json=body)


# --- Bandwidth Allocations ---

async def list_bandwidth_allocations(client: ScmClient) -> dict:
    return await client.request_config("GET", PATH_PREFIX, "/bandwidth-allocations")


# --- Shared Infrastructure Settings ---

async def get_shared_infrastructure_settings(client: ScmClient) -> dict:
    return await client.request_config("GET", PATH_PREFIX, "/shared-infrastructure-settings")


# --- Sites ---

async def list_sites(
    client: ScmClient,
    folder: str = FOLDER_REMOTE_NETWORKS_DEFAULT,
    name: str | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> dict:
    params = drop_none({"folder": folder, "name": name, "offset": offset, "limit": limit})
    return await client.request_config("GET", PATH_PREFIX, "/sites", params=params)
