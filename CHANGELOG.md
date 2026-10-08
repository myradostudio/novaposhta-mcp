# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-08

First release. Every tool was run against the live Nova Poshta API without an API key on 2026-10-08; nothing has been verified with a personal API key yet.

### Added

- stdio MCP server, started with `npx -y @myradostudio/novaposhta-mcp`. It needs no configuration: the API key is optional.
- 7 read-only tools: `track_parcels`, `search_settlements`, `search_warehouses`, `list_warehouse_types`, `search_streets`, `estimate_delivery_cost`, `estimate_delivery_date`.
- No write tools. The client refuses any API method outside its catalogue of lookups and calculations.
- A request timeout, no following of redirects, API errors returned as tool errors in the words of the API with a hint for the error codes seen on the live API.
- `npm run live-check`, which runs every tool against the real API.
- `server.json` for the MCP registry.
- Tests with a mocked HTTP layer that check every request against the list of properties tried on the live API, and an end-to-end test over stdio.

[0.1.0]: https://github.com/myradostudio/novaposhta-mcp/releases/tag/v0.1.0
