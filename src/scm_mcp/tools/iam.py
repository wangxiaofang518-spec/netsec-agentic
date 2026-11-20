"""IAM tools — source: iam/ServiceAccounts.yaml, iam/Roles.yaml,
iam/CustomRoles.yaml, iam/AccessPolicies.yaml.

All paths already include the /iam/v1/... prefix in the YAML, so requests
go straight to IAM_HOST with no PATH_PREFIX (see client.request_iam).

create_service_account / reset_service_account responses contain a
plaintext client_secret — callers must not persist these responses to logs.
"""

from scm_mcp.client import ScmClient, drop_none


# --- Service Accounts ---

async def list_service_accounts(client: ScmClient) -> dict:
    return await client.request_iam("GET", "/iam/v1/service_accounts")


async def create_service_account(
    client: ScmClient,
    name: str,
    contact_email: str | None = None,
    description: str | None = None,
) -> dict:
    body = drop_none({"name": name, "contact_email": contact_email, "description": description})
    return await client.request_iam("POST", "/iam/v1/service_accounts", json=body)


async def get_service_account(client: ScmClient, id: str) -> dict:
    return await client.request_iam("GET", f"/iam/v1/service_accounts/{id}")


async def update_service_account(
    client: ScmClient,
    id: str,
    contact_email: str | None = None,
    description: str | None = None,
) -> dict:
    body = drop_none({"contact_email": contact_email, "description": description})
    return await client.request_iam("PUT", f"/iam/v1/service_accounts/{id}", json=body)


async def delete_service_account(client: ScmClient, id: str) -> dict:
    return await client.request_iam("DELETE", f"/iam/v1/service_accounts/{id}")


async def reset_service_account(client: ScmClient, id: str) -> dict:
    return await client.request_iam(
        "POST", f"/iam/v1/service_accounts/{id}/operations/reset"
    )


# --- Roles (built-in, read-only) ---

async def list_roles(client: ScmClient) -> dict:
    return await client.request_iam("GET", "/iam/v1/roles")


# --- Custom Roles ---

async def list_custom_roles(client: ScmClient) -> dict:
    return await client.request_iam("GET", "/iam/v1/custom_roles")


async def create_custom_role(
    client: ScmClient,
    name: str,
    description: str,
    permission_sets: list[dict] | None = None,
    permissions: list[str] | None = None,
) -> dict:
    body = drop_none(
        {
            "name": name,
            "description": description,
            "permission_sets": permission_sets,
            "permissions": permissions,
        }
    )
    return await client.request_iam("POST", "/iam/v1/custom_roles", json=body)


# --- Access Policies ---

async def list_access_policies(
    client: ScmClient, role: str | None = None, principal: str | None = None
) -> dict:
    params = drop_none({"role": role, "principal": principal})
    return await client.request_iam("GET", "/iam/v1/access_policies", params=params)


async def get_access_policy(client: ScmClient, id: str) -> dict:
    return await client.request_iam("GET", f"/iam/v1/access_policies/{id}")


async def create_access_policy(
    client: ScmClient, principal: str, resource: str, role: str
) -> dict:
    body = {"principal": principal, "resource": resource, "role": role}
    return await client.request_iam("POST", "/iam/v1/access_policies", json=body)


async def delete_access_policy(client: ScmClient, id: str) -> dict:
    return await client.request_iam("DELETE", f"/iam/v1/access_policies/{id}")
