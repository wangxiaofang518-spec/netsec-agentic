"""MCP stdio server entry point for scm-mcp.

Registers every tool function from scm_mcp.tools.* against a single
ScmClient instance, using functools.partial to bind `client` so FastMCP's
signature introspection only sees the caller-facing parameters.
"""

import functools

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from scm_mcp.client import ScmClient
from scm_mcp.tools import deployment, iam, objects, operations, security

mcp = FastMCP(name="scm-mcp")
_client = ScmClient()


def _register(fn, name: str, description: str, destructive: bool = False) -> None:
    bound = functools.partial(fn, _client)
    bound.__name__ = name  # func_metadata() reads __name__ directly, not just the name= kwarg
    mcp.add_tool(
        bound,
        name=name,
        description=description,
        annotations=ToolAnnotations(destructiveHint=destructive),
    )


# --- Objects (config/sase/objects/objects-june.yaml) ---

_register(objects.list_addresses, "list_addresses", "List SCM address objects.")
_register(objects.create_address, "create_address", "Create an SCM address object.")
_register(objects.get_address, "get_address", "Get an SCM address object by UUID.")
_register(objects.update_address, "update_address", "Update an SCM address object by UUID.")
_register(
    objects.delete_address,
    "delete_address",
    "Delete an SCM address object by UUID.",
    destructive=True,
)

_register(objects.list_address_groups, "list_address_groups", "List SCM address groups.")
_register(objects.create_address_group, "create_address_group", "Create an SCM address group.")
_register(objects.get_address_group, "get_address_group", "Get an SCM address group by UUID.")
_register(
    objects.update_address_group, "update_address_group", "Update an SCM address group by UUID."
)
_register(
    objects.delete_address_group,
    "delete_address_group",
    "Delete an SCM address group by UUID.",
    destructive=True,
)

_register(objects.list_applications, "list_applications", "List SCM applications.")
_register(objects.create_application, "create_application", "Create an SCM application.")
_register(objects.get_application, "get_application", "Get an SCM application by UUID.")
_register(
    objects.update_application, "update_application", "Update an SCM application by UUID."
)
_register(
    objects.delete_application,
    "delete_application",
    "Delete an SCM application by UUID.",
    destructive=True,
)

_register(
    objects.list_application_groups, "list_application_groups", "List SCM application groups."
)
_register(
    objects.create_application_group,
    "create_application_group",
    "Create an SCM application group.",
)

_register(objects.list_services, "list_services", "List SCM service objects.")
_register(objects.create_service, "create_service", "Create an SCM service object.")
_register(objects.get_service, "get_service", "Get an SCM service object by UUID.")
_register(objects.update_service, "update_service", "Update an SCM service object by UUID.")
_register(
    objects.delete_service,
    "delete_service",
    "Delete an SCM service object by UUID.",
    destructive=True,
)

_register(objects.list_service_groups, "list_service_groups", "List SCM service groups.")

_register(objects.list_tags, "list_tags", "List SCM tags.")
_register(objects.create_tag, "create_tag", "Create an SCM tag.")
_register(objects.delete_tag, "delete_tag", "Delete an SCM tag by UUID.", destructive=True)

_register(
    objects.list_external_dynamic_lists,
    "list_external_dynamic_lists",
    "List SCM external dynamic lists.",
)


# --- Security (config/sase/security/security-services-R2-2026.yaml) ---

_register(security.list_security_rules, "list_security_rules", "List SCM security rules.")
_register(security.create_security_rule, "create_security_rule", "Create an SCM security rule.")
_register(security.get_security_rule, "get_security_rule", "Get an SCM security rule by UUID.")
_register(
    security.update_security_rule, "update_security_rule", "Update an SCM security rule by UUID."
)
_register(
    security.delete_security_rule,
    "delete_security_rule",
    "Delete an SCM security rule by UUID.",
    destructive=True,
)
_register(
    security.move_security_rule,
    "move_security_rule",
    "Move an SCM security rule to a new position within its rulebase.",
    destructive=True,
)

_register(
    security.list_anti_spyware_profiles,
    "list_anti_spyware_profiles",
    "List SCM anti-spyware profiles.",
)
_register(
    security.create_anti_spyware_profile,
    "create_anti_spyware_profile",
    "Create an SCM anti-spyware profile.",
)
_register(
    security.list_vulnerability_protection_profiles,
    "list_vulnerability_protection_profiles",
    "List SCM vulnerability protection profiles.",
)
_register(
    security.list_url_access_profiles, "list_url_access_profiles", "List SCM URL access profiles."
)
_register(security.list_decryption_rules, "list_decryption_rules", "List SCM decryption rules.")
_register(
    security.list_dos_protection_rules,
    "list_dos_protection_rules",
    "List SCM DoS protection rules.",
)
_register(
    security.list_url_categories,
    "list_url_categories",
    "List SCM custom URL categories. The 'list' array holds each category's members "
    "(domains/URLs for a URL List, or built-in category names for a Category Match) — "
    "use this to expand a custom URL category referenced by a security rule's category "
    "field and see its real members, not just its name.",
)
_register(
    security.get_url_category,
    "get_url_category",
    "Get one SCM custom URL category by UUID, including its full member 'list'.",
)


# --- Deployment (config/sase/deployment/deployment-services-june.yaml) ---

_register(deployment.list_remote_networks, "list_remote_networks", "List SCM remote networks.")
_register(
    deployment.create_remote_network, "create_remote_network", "Create an SCM remote network."
)
_register(
    deployment.get_remote_network, "get_remote_network", "Get an SCM remote network by UUID."
)
_register(
    deployment.update_remote_network,
    "update_remote_network",
    "Update an SCM remote network by UUID.",
)
_register(
    deployment.delete_remote_network,
    "delete_remote_network",
    "Delete an SCM remote network by UUID.",
    destructive=True,
)

_register(
    deployment.list_service_connections,
    "list_service_connections",
    "List SCM service connections.",
)
_register(
    deployment.create_service_connection,
    "create_service_connection",
    "Create an SCM service connection.",
)

_register(deployment.list_locations, "list_locations", "List SCM deployment locations.")
_register(deployment.get_bgp_routing, "get_bgp_routing", "Get SCM BGP routing settings.")
_register(deployment.update_bgp_routing, "update_bgp_routing", "Update SCM BGP routing settings.")
_register(
    deployment.list_bandwidth_allocations,
    "list_bandwidth_allocations",
    "List SCM bandwidth allocations.",
)
_register(
    deployment.get_shared_infrastructure_settings,
    "get_shared_infrastructure_settings",
    "Get SCM shared infrastructure settings.",
)
_register(deployment.list_sites, "list_sites", "List SCM sites.")


# --- Operations (config/sase/operations/config-operations-march.yaml) ---

_register(operations.list_jobs, "list_jobs", "List SCM configuration jobs.")
_register(operations.get_job, "get_job", "Get an SCM configuration job by ID.")
_register(operations.list_config_versions, "list_config_versions", "List SCM config versions.")
_register(
    operations.get_config_version, "get_config_version", "Get an SCM config version by number."
)
_register(
    operations.get_running_config_version,
    "get_running_config_version",
    "Get the SCM running config versions per folder/device.",
)
_register(
    operations.load_config_version,
    "load_config_version",
    "Load a specific SCM config version into the candidate configuration.",
    destructive=True,
)
_register(
    operations.delete_candidate_config,
    "delete_candidate_config",
    "Discard the SCM candidate configuration.",
    destructive=True,
)
_register(
    operations.push_candidate_config,
    "push_candidate_config",
    "Push the SCM candidate configuration to production folders or devices. "
    "This changes live SCM/NGFW state — confirm the folder/devices scope before calling.",
    destructive=True,
)


# --- IAM (iam/ServiceAccounts.yaml, Roles.yaml, CustomRoles.yaml, AccessPolicies.yaml) ---

_register(iam.list_service_accounts, "list_service_accounts", "List SCM IAM service accounts.")
_register(
    iam.create_service_account,
    "create_service_account",
    "Create an SCM IAM service account. Response contains a plaintext client_secret.",
)
_register(
    iam.get_service_account, "get_service_account", "Get an SCM IAM service account by ID."
)
_register(
    iam.update_service_account,
    "update_service_account",
    "Update an SCM IAM service account by ID.",
)
_register(
    iam.delete_service_account,
    "delete_service_account",
    "Delete an SCM IAM service account by ID.",
    destructive=True,
)
_register(
    iam.reset_service_account,
    "reset_service_account",
    "Reset an SCM IAM service account's credentials. Response contains a plaintext "
    "client_secret.",
    destructive=True,
)

_register(iam.list_roles, "list_roles", "List SCM IAM built-in roles.")
_register(iam.list_custom_roles, "list_custom_roles", "List SCM IAM custom roles.")
_register(iam.create_custom_role, "create_custom_role", "Create an SCM IAM custom role.")

_register(iam.list_access_policies, "list_access_policies", "List SCM IAM access policies.")
_register(
    iam.get_access_policy, "get_access_policy", "Get an SCM IAM access policy by ID."
)
_register(
    iam.create_access_policy,
    "create_access_policy",
    "Assign an SCM IAM access policy (role) to a principal on a resource.",
)
_register(
    iam.delete_access_policy,
    "delete_access_policy",
    "Delete an SCM IAM access policy by ID.",
    destructive=True,
)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
