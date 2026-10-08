/** Tool metadata, annotations, server instructions, the read-only guarantee and error rendering. */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { z } from 'zod';

import { NovaPoshtaClient } from '../src/client.js';
import { runTool } from '../src/server.js';
import { CARGO_TYPES, SERVICE_TYPES, tools } from '../src/tools/read.js';
import { defineTool, READ_ONLY } from '../src/tools/types.js';
import { SERVER_NAME, SERVER_VERSION } from '../src/version.js';
import { assertMatchesContract, CARGO_TYPES_SENT, LIVE_CHECKED, MAX_LIMIT_SENT, SERVICE_TYPES_SENT } from './support/contract.js';
import { FakeApi, failure, ok } from './support/fake-api.js';
import * as fixtures from './support/fixtures.js';
import { NUMBERS, REFS } from './support/fixtures.js';
import { API_KEY, createHarness, testConfig, type Harness } from './support/harness.js';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const TOOL_NAMES = [
  'track_parcels',
  'search_settlements',
  'search_warehouses',
  'list_warehouse_types',
  'search_streets',
  'estimate_delivery_cost',
  'estimate_delivery_date',
];

describe('server metadata', () => {
  it('introduces itself with its name, version and what it cannot do', async () => {
    harness = await createHarness();

    assert.deepEqual(
      { name: harness.mcp.getServerVersion()?.name, version: harness.mcp.getServerVersion()?.version },
      { name: SERVER_NAME, version: SERVER_VERSION },
    );
    const instructions = harness.mcp.getInstructions() ?? '';
    assert.match(instructions, /Unofficial, read-only/);
    assert.match(instructions, /cannot create, change or cancel a waybill/);
    assert.match(instructions, /`DeliveryCity`/);
    assert.match(instructions, /No API key is configured/);
  });

  it('says so in the instructions when a key is configured, without showing it', async () => {
    harness = await createHarness({ apiKey: API_KEY });

    const instructions = harness.mcp.getInstructions() ?? '';
    assert.match(instructions, /A personal API key is configured/);
    assert.ok(!instructions.includes(API_KEY));
  });

  it('lists the seven tools, each with a unique snake_case name, title, description and object schema', async () => {
    harness = await createHarness();

    const { tools: listed } = await harness.mcp.listTools();

    assert.deepEqual(listed.map((tool) => tool.name), TOOL_NAMES);
    for (const tool of listed) {
      assert.match(tool.name, /^[a-z]+(_[a-z]+)+$/, tool.name);
      assert.ok((tool.title ?? '').length > 0, `${tool.name}: title`);
      assert.ok((tool.description ?? '').length >= 80, `${tool.name}: description`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name}: input schema`);
    }
  });

  it('documents every argument of every tool', async () => {
    harness = await createHarness();

    const { tools: listed } = await harness.mcp.listTools();

    for (const tool of listed) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [name, property] of Object.entries(properties)) {
        assert.ok((property.description ?? '').length > 0, `${tool.name}.${name} has no description`);
      }
    }
  });
});

describe('read-only guarantee', () => {
  it('marks every tool as read-only and idempotent', async () => {
    harness = await createHarness({ apiKey: API_KEY });

    const { tools: listed } = await harness.mcp.listTools();

    for (const tool of listed) {
      assert.deepEqual(
        tool.annotations,
        { title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        tool.name,
      );
    }
  });

  it('every tool calls only methods of the read-only catalogue, with properties tried on the live API', async () => {
    // Guards the promise at the source: a tool that calls InternetDocument.save, or sends a property nobody tried, fails here.
    const api = new FakeApi();
    api.on('TrackingDocument.getStatusDocuments', ok([fixtures.unknownParcel]));
    api.on('Address.searchSettlements', ok([fixtures.settlements]));
    api.on('Address.searchSettlementStreets', ok([fixtures.streets]));
    api.on('AddressGeneral.getWarehouses', ok([fixtures.warehouse], { info: { totalCount: 1 } }));
    api.on('AddressGeneral.getWarehouseTypes', ok(fixtures.warehouseTypes));
    api.on('InternetDocument.getDocumentPrice', ok([fixtures.price]));
    api.on('InternetDocument.getDocumentDeliveryDate', ok([fixtures.deliveryDate]));
    harness = await createHarness({}, api);
    const route = { city_sender_ref: REFS.kyivCity, city_recipient_ref: REFS.brovaryCity };
    const everyArgument: Record<string, Record<string, unknown>> = {
      track_parcels: { numbers: [NUMBERS.unknown], phone: '380501234567', all_fields: true },
      search_settlements: { name: 'Бровари', limit: 5, page: 1 },
      search_warehouses: {
        city_name: 'Бровари',
        city_ref: REFS.brovaryCity,
        settlement_ref: REFS.brovarySettlement,
        warehouse_ref: REFS.branch,
        number: 2,
        search: 'Київська',
        type_ref: REFS.branchType,
        limit: 5,
        page: 1,
      },
      list_warehouse_types: {},
      search_streets: { settlement_ref: REFS.brovarySettlement, name: 'Київ', limit: 5 },
      estimate_delivery_cost: {
        ...route,
        weight_kg: 2.5,
        service_type: 'DoorsDoors',
        cargo_type: 'Parcel',
        declared_value: 1500,
        seats: 2,
        volume_m3: 0.02,
        cash_on_delivery: 1500,
      },
      estimate_delivery_date: { ...route, service_type: 'DoorsWarehouse', send_date: '2026-10-12' },
    };

    for (const tool of tools) {
      const args = everyArgument[tool.name];
      assert.ok(args, `${tool.name} has no sample arguments in this test`);
      const result = await harness.call(tool.name, args);
      assert.equal(result.isError, false, `${tool.name}: ${result.text}`);
    }

    assert.equal(api.requests.length, tools.length);
    const called = api.requests.map((request) => assertMatchesContract(request));
    assert.deepEqual([...new Set(called)].sort(), Object.keys(LIVE_CHECKED).sort(), 'every catalogued method is used by a tool');
    // With every argument given, every property the live check tried is sent: none is listed without a use.
    for (const request of api.requests) {
      assert.deepEqual(Object.keys(request.properties).sort(), Object.keys(LIVE_CHECKED[request.called] ?? {}).sort(), request.called);
    }
  });
});

describe('what the tools offer vs. what the live check sent', () => {
  it('offers only the service and cargo types that were sent to the live API', async () => {
    harness = await createHarness();

    const { tools: listed } = await harness.mcp.listTools();
    const enumOf = (tool: string, argument: string) =>
      ((listed.find((candidate) => candidate.name === tool)?.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>)[argument]?.enum;

    // Adding a value to a tool without sending it in scripts/live-check.mjs fails here.
    assert.deepEqual([...SERVICE_TYPES], SERVICE_TYPES_SENT);
    assert.deepEqual([...CARGO_TYPES], CARGO_TYPES_SENT);
    assert.deepEqual(enumOf('estimate_delivery_cost', 'service_type'), SERVICE_TYPES_SENT);
    assert.deepEqual(enumOf('estimate_delivery_date', 'service_type'), SERVICE_TYPES_SENT);
    assert.deepEqual(enumOf('estimate_delivery_cost', 'cargo_type'), CARGO_TYPES_SENT);
  });

  it('never asks a directory for a larger page than the live check did', async () => {
    const api = new FakeApi();
    api.on('Address.searchSettlements', ok([fixtures.settlements]));
    api.on('Address.searchSettlementStreets', ok([fixtures.streets]));
    api.on('AddressGeneral.getWarehouses', ok([fixtures.warehouse], { info: { totalCount: 1 } }));
    harness = await createHarness({}, api);

    await harness.callJson('search_settlements', { name: 'нов', limit: 100_000 });
    await harness.callJson('search_streets', { settlement_ref: REFS.brovarySettlement, name: 'ки', limit: 100_000 });
    await harness.callJson('search_warehouses', { city_name: 'Київ', limit: 100_000 });

    assert.deepEqual(
      api.requests.map((request) => request.properties['Limit']),
      [MAX_LIMIT_SENT.settlements, MAX_LIMIT_SENT.streets, MAX_LIMIT_SENT.warehouses],
    );
    for (const request of api.requests) assertMatchesContract(request);
  });
});

describe('personal data', () => {
  it('the tracking tool says that a phone number brings personal data', async () => {
    harness = await createHarness();

    const { tools: listed } = await harness.mcp.listTools();
    const description = listed.find((tool) => tool.name === 'track_parcels')?.description ?? '';

    assert.match(description, /personal data/);
  });

  it('the cost tool says that nothing is created', async () => {
    harness = await createHarness();

    const { tools: listed } = await harness.mcp.listTools();

    assert.match(listed.find((tool) => tool.name === 'estimate_delivery_cost')?.description ?? '', /no waybill is created/);
    assert.match(listed.find((tool) => tool.name === 'estimate_delivery_date')?.description ?? '', /no waybill is created/);
  });
});

describe('error rendering', () => {
  it('returns API errors as isError results in the words of the API, without the key', async () => {
    harness = await createHarness({ apiKey: API_KEY });
    harness.api.on('AddressGeneral.getWarehouseTypes', failure([`User ${API_KEY} is undefined`], ['20000101582']));

    const result = await harness.call('list_warehouse_types');

    assert.equal(result.isError, true);
    assert.equal(
      result.text,
      'Nova Poshta API error: User [redacted] is undefined\nThis method needs a personal API key. Set NOVAPOSHTA_API_KEY.',
    );
  });

  it('never exposes a stack trace, whatever a handler throws', async () => {
    const config = testConfig();
    const context = { config, client: new NovaPoshtaClient({ config, fetch: new FakeApi().fetch }) };
    const failing = (thrown: unknown) =>
      defineTool({
        name: 'failing_tool',
        title: 'Failing tool',
        description: 'Always fails.',
        inputSchema: z.object({}),
        annotations: READ_ONLY,
        handler: async () => {
          throw thrown;
        },
      });

    const fromError = await runTool(failing(new TypeError("Cannot read properties of undefined (reading 'x')")), {}, context);
    const fromString = await runTool(failing('plain string'), {}, context);

    assert.deepEqual(fromError, {
      content: [{ type: 'text', text: "Cannot read properties of undefined (reading 'x')" }],
      isError: true,
    });
    assert.deepEqual(fromString, { content: [{ type: 'text', text: 'Unexpected error.' }], isError: true });
    assert.doesNotMatch(JSON.stringify(fromError), /\bat .*\.js/);
  });
});
