# Nora Heart

A personal AI harness with interchangeable model providers, tools, memory and
persistence. TypeScript, Node.js 24 and a mobile-first web interface.

Heart orchestrates conversations and execution. Its core is independent of concrete
LLM SDKs, tools and database clients. Explicit composition connects the modules.

- Model adapters: ChatGPT subscription, OpenAI, Anthropic, OpenRouter, Venice and a local demo.
- Tools: files, sandboxed terminal, opt-in host execution, MCP connections and skills.
- Remote MCP authorities: projects, structured memory and vault; separate user-scoped keys.
- Local conversation history and execution state; PostgreSQL or SQLite adapters.
- Context budgeting, compression, memory revisions and verified action receipts.
- Persistent scheduled tasks, interactive forms and concurrent conversations.
- Local wallets: multi-network assets, offline EVM/Solana signing, persistent
  JavaScript/Python clients and verified MCP Vault recovery. See [wallet documentation](docs/WALLETS.md).

This is actively developed software, not a claim of complete Codex CLI parity.
A simulated provider is not evidence that a real integration works.

## Quick start

Install on a Debian 12+/Ubuntu 24.04+ server, choosing your directory:

```sh
curl -fsSL https://raw.githubusercontent.com/natiojerome/nora-heart/main/install.sh | sudo bash -s -- --path /srv/my-assistant
```

By default, open the printed `http://SERVER_IP:port` address; no domain is needed.
Use `--address IP` to override detection, `--port 4215` to choose the port, or
`--private` for localhost access through SSH. Add `--domain assistant.example.com`
for automatic HTTPS (DNS must point to the server, ports 80/443 available).
Direct HTTP traffic is not encrypted. PostgreSQL, local tools and services
are prepared automatically. First login opens onboarding; connect your own model
provider and MCP services. No shared credentials or wallets are supplied.
See [installation and onboarding](docs/INSTALLATION.md) for prerequisites,
permanent password retrieval, restart/resume and data locations.

For development:

Use Node.js 24 and pnpm 12.15.0. Linux terminal/development checks need Bubblewrap
and ripgrep; see [development setup](docs/DEVELOPMENT.md).

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:local
```

The demo uses disposable local data and no paid inference. For the web interface,
configure your own private environment using [.env.example](.env.example) and
[WEB.md](docs/WEB.md); select/migrate your SQL backend explicitly. Credentials
belong outside the repository. Shared production URLs are not demo accounts.

MCP-backed project management is selected with `HARNESS_PROJECTS_MCP_CONNECTION_ID`;
remote memory with `HARNESS_MEMORY_MCP_CONNECTION_ID`. These are approved connection
IDs, not keys. Project creation requires a configured Projects connection; there
is no default local project catalog. Once selected, unavailable remote services do not fall back to local
business data. Files remain on the Heart host. Remote conversation storage is deferred.
The separate Nora MCP services are not bundled in this repository.

## Documentation and contributing

- [Current status](docs/STATUS.md) and [plan](docs/PLAN.md)
- [Architecture](docs/ARCHITECTURE.md) and [decisions](docs/DECISIONS.md)
- [Testing](docs/TESTING.md), [MCP integration](docs/NORA-MCPS.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), [publication scope](docs/PUBLICATION.md)

MIT for Heart's own code. Third-party components keep their notices and licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
