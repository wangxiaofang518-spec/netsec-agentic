# Notice

**Not an official Palo Alto Networks product.** NetSec-Agentic is a community / reference project built in a Palo Alto Networks lab with Claude. It is provided as-is, without warranty or support. Test it in a lab before using it anywhere near production, and prefer `AGENT_MODE=readonly` with read-only API credentials.

**Trademarks.** Palo Alto Networks, Prisma, Strata, Cortex, GlobalProtect and related names and logos are trademarks of Palo Alto Networks, Inc. Claude is a trademark of Anthropic. Other names may be trademarks of their respective owners. Product icons under `topo/web/assets/` are used only to label the corresponding components.

**What was removed from this public copy.** This repository is generated from a private working copy by an automated, audited export:

| Removed / replaced | How |
|---|---|
| API keys, tokens, client secrets, the encrypted credential bundle | removed; templates show the variable names only |
| SSH keys and TLS certificates / private keys | removed |
| Public IP addresses | replaced with RFC 5737 documentation addresses (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) |
| Tenant / TSG IDs, service accounts, device serial numbers | replaced with `<placeholders>` |
| Personal names in usernames and configuration object names | replaced with neutral names (e.g. `alice`, `corp-*`, `lab-*`) |
| Login credentials | no default password: set `TOPO_AUTH_PASS`, or a random one is generated at start-up |
| Private assistant notes, raw inspection logs | removed |

Private (RFC 1918) addresses and the lab's internal data-center range `172.172.0.0/16` are kept so the examples and the agent's knowledge base stay consistent.
