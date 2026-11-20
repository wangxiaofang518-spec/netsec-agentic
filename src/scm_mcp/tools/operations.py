"""Operations tools — source: config/sase/operations/config-operations-march.yaml.

Covers the DESIGN.md section 4 scope: jobs, config-versions, and the
candidate-config push/load/delete lifecycle.

push_candidate_config is the only tool here that mutates production
config/devices — server.py must surface that in the tool description so
MCP clients prompt for confirmation before calling it.
"""

from scm_mcp.client import ScmClient

PATH_PREFIX = "/config/operations/v1"


# --- Jobs ---

async def list_jobs(client: ScmClient) -> dict:
    return await client.request_config("GET", PATH_PREFIX, "/jobs")


async def get_job(client: ScmClient, id: str) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/jobs/{id}")


# --- Config Versions ---

async def list_config_versions(client: ScmClient) -> dict:
    return await client.request_config("GET", PATH_PREFIX, "/config-versions")


async def get_config_version(client: ScmClient, version: int) -> dict:
    return await client.request_config("GET", PATH_PREFIX, f"/config-versions/{version}")


async def get_running_config_version(client: ScmClient) -> dict:
    return await client.request_config("GET", PATH_PREFIX, "/config-versions/running")


async def load_config_version(client: ScmClient, version: int) -> dict:
    return await client.request_config(
        "POST", PATH_PREFIX, "/config-versions:load", json={"version": version}
    )


async def delete_candidate_config(client: ScmClient) -> dict:
    return await client.request_config("DELETE", PATH_PREFIX, "/config-versions/candidate")


async def push_candidate_config(
    client: ScmClient,
    folder: list[str] | None = None,
    devices: list[int] | None = None,
    admin: list[str] | None = None,
    description: str | None = None,
) -> dict:
    """Pushes the candidate configuration to production folders or devices.

    Exactly one of `folder` or `devices` must be provided (YAML: allOf
    with two required-exclusive branches). This changes live SCM/NGFW
    state — callers must confirm scope before invoking.
    """
    if (folder is None) == (devices is None):
        return {
            "error": "400",
            "detail": "push_candidate_config requires exactly one of folder or devices",
        }

    body: dict = {}
    if folder is not None:
        body["folder"] = folder
    if devices is not None:
        body["devices"] = devices
    if admin is not None:
        body["admin"] = admin
    if description is not None:
        body["description"] = description

    return await client.request_config(
        "POST", PATH_PREFIX, "/config-versions/candidate:push", json=body
    )
