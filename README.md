# novaposhta-mcp

A read-only [MCP](https://modelcontextprotocol.io) server for the API of [Nova Poshta](https://novaposhta.ua), the Ukrainian delivery company. It lets an AI assistant such as Claude track parcels, find branches and parcel lockers, look up settlements and streets, and estimate what a delivery costs and when it arrives.

Українською: [README.uk.md](README.uk.md)

> **Unofficial.** This project is not affiliated with or endorsed by Nova Poshta. "Nova Poshta" is a trademark of its owner. Use it at your own risk.

> **Status: 0.1.0.** Every tool was checked against the live API without an API key on 2026-10-08: `npm run live-check` starts the built server and calls each tool with every argument it has. The server is not yet verified with a personal API key, and tracking was checked only for a number Nova Poshta does not know, so the compact view of a real parcel is built from the field names of a live answer rather than tried on parcels of our own. See [Limitations](#limitations).

## What it is for

- **"Where is my parcel?"** A support bot or a voice agent answers by waybill number.
- **"Which branch is closest, and is it open on Sunday?"** The assistant finds branches and lockers in a town with their addresses and hours.
- **"How much is delivery to Lviv and when will it get there?"** An estimate straight from the carrier's calculator, for a shop assistant or an order form.

The server does not create, change or cancel waybills. It has no write tools, and its API client refuses every method outside a short list of lookups and calculations.

## Quick start

You need Node.js 20 or newer. **No key is needed to start.** A personal API key from your Nova Poshta business cabinet is optional; see [Configuration](#configuration).

> **Not on npm yet.** Until the first release is published, the `npx -y @myradostudio/novaposhta-mcp` commands below will not work. Run the server from source instead: `git clone https://github.com/myradostudio/novaposhta-mcp`, then `npm install` and `npm run build` in that folder, and use `"command": "node"` with `"args": ["/absolute/path/to/novaposhta-mcp/dist/index.js"]` in the configurations below.

### Claude Desktop

Add the server to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "novaposhta": {
      "command": "npx",
      "args": ["-y", "@myradostudio/novaposhta-mcp"]
    }
  }
}
```

With a key, add `"env": { "NOVAPOSHTA_API_KEY": "your API key" }` to that block.

If the server does not start on Windows, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "@myradostudio/novaposhta-mcp"]`.

### Claude Code

```bash
claude mcp add --transport stdio novaposhta -- npx -y @myradostudio/novaposhta-mcp
```

### Cursor

Add the same block to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "novaposhta": {
      "command": "npx",
      "args": ["-y", "@myradostudio/novaposhta-mcp"]
    }
  }
}
```

Any other MCP client that can start a local stdio server works the same way: run `npx -y @myradostudio/novaposhta-mcp`.

Then ask, for example:

- "Track parcel 20450000000000."
- "Which Nova Poshta branches are there in Brovary on Kyivska street, and when do they work?"
- "Find parcel lockers in Irpin."
- "How much does it cost to send a 2.5 kg parcel from Kyiv to Lviv, branch to branch, with 1500 UAH cash on delivery? When will it arrive if I send it on Monday?"

## Configuration

The server is configured with environment variables only, and both are optional.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NOVAPOSHTA_API_KEY` | no | | Personal API key from the Nova Poshta business cabinet. Sent with every request when set. |
| `NOVAPOSHTA_API_URL` | no | `https://api.novaposhta.ua` | API origin. Must be `https://` (plain `http://` is accepted for localhost only). |

**About working without a key.** The Nova Poshta API is designed around a personal key. On 2026-10-08 all seven methods this server calls answered without one, and that is how the server was checked. Nova Poshta does not promise this, so set a key for anything you rely on. Whether a key changes the answers (for example, whether a cost estimate then follows your own contract) has not been verified by this project.

## Tools

Places are identified by GUIDs that Nova Poshta calls `Ref`. A settlement returned by `search_settlements` carries two: `Ref` identifies the settlement and `DeliveryCity` identifies the city used for tariffs. The tools say which one they want. Names of settlements and streets are searched in Ukrainian letters; the API refuses Latin ones. Money is in hryvnias, weight in kilograms.

| Tool | What it returns | API method |
| --- | --- | --- |
| `track_parcels` | Status, route, dates, weight and cost of up to 100 parcels by waybill number | `TrackingDocument.getStatusDocuments` |
| `search_settlements` | Settlements by name or its beginning, with region, the number of branches and both identifiers | `Address.searchSettlements` |
| `search_warehouses` | Branches and parcel lockers of a city or settlement: address, hours, weight limit, coordinates | `AddressGeneral.getWarehouses` |
| `list_warehouse_types` | Types of service points (post branch, cargo branch, parcel locker), to filter `search_warehouses` | `AddressGeneral.getWarehouseTypes` |
| `search_streets` | Streets of a settlement by a word of the name | `Address.searchSettlementStreets` |
| `estimate_delivery_cost` | Delivery cost between two cities for a weight, with optional declared value, volume and cash on delivery | `InternetDocument.getDocumentPrice` |
| `estimate_delivery_date` | Estimated arrival date between two cities | `InternetDocument.getDocumentDeliveryDate` |

Every method is called as `POST https://api.novaposhta.ua/v2.0/json/`.

Notes on the tools:

- **`track_parcels`.** Without a phone number the answer is what public tracking shows. With the phone of the sender or the recipient Nova Poshta adds names, phones and addresses; that is personal data and it goes to the AI model. A number Nova Poshta does not know comes back with `found: false`. Fields that are empty, zero or false are left out; `all_fields: true` returns every other field instead of the compact selection.
- **`search_settlements`** also returns settlements whose former name or district matches the text (a search for «нов» finds Zviahel, formerly Novohrad-Volynskyi), so the model is told to read the full name before choosing.
- **`search_warehouses`** wants a place: `city_name` (the full name, not its beginning), `city_ref`, `settlement_ref`, or `warehouse_ref` for one branch. Without a place the API would return all branches of the country, so the tool refuses.
- **`search_streets`** needs at least two letters: one letter found nothing on the live API.
- **`estimate_delivery_cost` and `estimate_delivery_date`** are calculations. They create nothing and reserve nothing. Nova Poshta sometimes adjusts the input (for example the cargo type) and says so in `warnings`, which the tool passes on. Cargo types are parcel, cargo and documents; tyres and pallets are not offered, because the API refuses them without their sizes.

## Safety model

- **Read-only, with no switch to change that.** There are no write tools. The API has a single address and no HTTP verb that tells a read from a write, so the guarantee is a catalogue: the client calls seven named methods and refuses any other. A test checks that every tool stays inside it.
- **Nothing is sent that was not tried for real.** Nova Poshta publishes no machine-readable description of its API. In its place the tests hold the list of properties, service types, cargo types and page sizes that the live check sent and the API accepted, and fail when a tool sends or offers anything else. Free text (names, numbers, phones) and amounts are of course your own.
- **Honest annotations.** Every tool carries `readOnlyHint: true`.
- **Strict input.** Every tool rejects arguments it does not know. Identifiers must look like a `Ref`, dates like dates.
- **The key stays local.** When set, it is read from an environment variable, sent only to `NOVAPOSHTA_API_URL` and never written to stdout or stderr. Every answer of the API is cleaned of the key before anything is built from it, so it cannot reach a tool result either. Redirects are not followed.
- **Less data to the model.** A tracking record has more than a hundred fields and a branch about sixty; tools return a compact selection. Russian duplicates of names are left out. In the compact views a value of zero is treated as absent, with one exception: the number of branches in a settlement, where zero is the answer.
- **No telemetry, no logging of business data.** stderr gets only startup messages and the type of a transport error.

Two things the server cannot do for you. First, whatever a tool returns is sent to the AI model you use and to its provider; with a phone number, tracking returns personal data. Second, the description of a parcel is written by its sender and reaches the model as-is, so it could contain instructions written by someone else (prompt injection).

## Limitations

- **Not yet verified with a personal API key.** Everything was checked without one. The live check can ask for a key (`npm run live-check:key`, see [Live check](#live-check)); it has not been run that way yet.
- **Tracking of a real parcel was not part of the check.** The live check tracks a made-up number and gets "not found". The compact view of a found parcel uses the field names of a live answer, but which fields matter most in each status is a judgement, not something tested on our own shipments. Use `all_fields: true` if something seems missing. The live check can track a waybill of your own as well; that has not been run yet either.
- **Status codes are not interpreted.** The tool returns `StatusCode` and the status text of Nova Poshta. The only code the server relies on is `3`, "not found", confirmed on the live API.
- **Only 14-digit waybill numbers were accepted** in the live check; other formats, if Nova Poshta has them, are passed to the API as they are.
- **The developer documentation could not be consulted.** `developers.novaposhta.ua` sits behind a bot check that an automated client must not get around. Parameter names and behaviour come from the answers of the live API. Rate limits are therefore unknown to this project, and the server does not pace its requests.
- **No write operations:** creating, changing or deleting waybills, registers, counterparties and addresses, ordering a courier, returns and redirections are all out of scope.
- **Not covered:** your own list of waybills, international delivery, packaging, time intervals, the map of branches, cost estimates for tyres and pallets.
- **The date formats of tracking are those of the API** and differ from field to field (`01-10-2026 19:18:12`, `2026-10-02 08:02:03`, `04.10.2026 08:10:48`). The server passes them on unchanged.
- **Fixed 30-second timeout** per request.

## Live check

`npm run live-check` starts the built server the way an MCP host does and calls every tool against `api.novaposhta.ua` with every argument it has. Each check prints one line, `PASS`, `FAIL` or `SKIP`, and the exit code is 1 when anything failed. The check reads public directories, asks for calculations and tracks a made-up number, so it changes nothing at Nova Poshta.

```bash
npm run live-check        # without a key
npm run live-check:key    # asks for your key and for a waybill of your own
```

`live-check:key` asks three questions and shows nothing of what you type:

1. your API key (Enter runs the check without a key);
2. the number of a waybill of your own (Enter leaves the real parcel out);
3. the phone of its sender or recipient (Enter tracks without a phone).

The key reaches the server through its environment, so it is neither in the command nor in the shell history, and the output is cleaned of it. Of your parcel the output names the fields that came back and says whether the check passed; it never shows the number, the phone, a name, an address or the status.

Without npm: `node scripts/live-check.mjs [--ask-key] [--ask-waybill]` after `npm run build`. Without `--ask-key` the key is read from `NOVAPOSHTA_API_KEY`.

## Development

```bash
npm install
npm run lint          # tsc --noEmit over src/ and tests/
npm test              # builds dist/ and the tests, then runs them with node:test
npm run live-check    # runs every tool against the real API (needs the network)
```

- `src/methods.ts` is the catalogue of API methods the server may call.
- `tests/support/contract.ts` lists, per method, the properties the live check sent. Every tool test calls the tool through a real MCP client, and when a test ends each request it recorded goes through `assertMatchesContract`.
- `scripts/live-check.mjs` is the other half: it starts `dist/index.js` over stdio and calls each tool against `api.novaposhta.ua`. It reads public directories, asks for calculations and tracks one made-up number. Run it after changing what a tool sends, then update the contract.
- `tests/live-check.test.ts` runs that script against a local stand-in for the API, including the cases in which it has to fail and the ones in which a key, a number or a phone must not reach the output.
- `tests/e2e.test.ts` starts the built server as a child process over stdio against a local HTTP mock.
- To poke at the server by hand: `npx @modelcontextprotocol/inspector node dist/index.js`.

The server uses the official TypeScript SDK ([`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)) and `zod`; there are no other runtime dependencies.

Issues and pull requests are welcome. For security reports see [SECURITY.md](SECURITY.md).

## Built by

Built and maintained by [Myrado Studio](https://myradostudio.com) — custom MCP servers, AI agents and automation. Need an MCP server for your own system? https://myradostudio.com/en/mcp-server-development/

## License

[MIT](LICENSE) © 2026 Myrado Studio
