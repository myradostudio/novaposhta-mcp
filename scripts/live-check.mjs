// Runs every tool of the built server against the real Nova Poshta API.
//
// The unit tests replace the API with a stand-in; this script is the other half:
// it starts dist/index.js the way an MCP host does and calls each tool with every
// argument it has, so that every property the server can send is sent at least
// once. It reads public directories and asks for calculations only. The one
// waybill number it tracks is made up and comes back as "not found".
//
// Usage:
//   npm run live-check                   without a key (public methods)
//   NOVAPOSHTA_API_KEY=… npm run live-check   with your key
//
// It needs the network, so it is not part of `npm test` or of CI.

import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SERVER_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const UNKNOWN_NUMBER = '20400000000000';

const env = { ...getDefaultEnvironment() };
if (process.env.NOVAPOSHTA_API_KEY) env.NOVAPOSHTA_API_KEY = process.env.NOVAPOSHTA_API_KEY;
if (process.env.NOVAPOSHTA_API_URL) env.NOVAPOSHTA_API_URL = process.env.NOVAPOSHTA_API_URL;

const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], env, stderr: 'ignore' });
const client = new Client({ name: 'live-check', version: '1.0.0' });
await client.connect(transport);

let failed = 0;

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  return { isError: result.isError === true, text, json: result.isError === true ? undefined : JSON.parse(text.slice(text.search(/^[{[]/m))) };
}

async function check(label, run) {
  try {
    const detail = await run();
    console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${label} — ${error instanceof Error ? error.message : error}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`Nova Poshta live check, ${new Date().toISOString().slice(0, 10)}, ${env.NOVAPOSHTA_API_KEY ? 'with an API key' : 'without an API key'}`);

let settlement;
let warehouse;
let lockerType;

await check('search_settlements: name, limit, page', async () => {
  const { json } = await call('search_settlements', { name: 'Бровари', limit: 2, page: 1 });
  settlement = json.settlements.find((item) => item.Area === 'Київська');
  expect(settlement, 'Brovary of Kyiv region was not found');
  expect(/^[0-9a-f-]{36}$/.test(settlement.Ref) && /^[0-9a-f-]{36}$/.test(settlement.DeliveryCity), 'no Ref or DeliveryCity');
  expect(json.pagination.total >= json.pagination.returned, 'pagination total is missing');
  return `${settlement.Present}; ${json.pagination.total} matches`;
});

await check('search_settlements: a Latin name is refused with a hint', async () => {
  const result = await call('search_settlements', { name: 'Kyiv' });
  expect(result.isError, 'expected an error');
  expect(result.text.includes('Ukrainian letters'), `no hint in: ${result.text}`);
  return result.text.split('\n')[0];
});

await check('list_warehouse_types', async () => {
  const { json } = await call('list_warehouse_types', {});
  lockerType = json.types.find((type) => type.Description === 'Поштомат');
  expect(json.types.length >= 3 && lockerType, 'no "Поштомат" type');
  return `${json.types.length} types`;
});

await check('search_warehouses: city_name, number', async () => {
  const { json } = await call('search_warehouses', { city_name: 'Бровари', number: 2, limit: 5, page: 1 });
  expect(json.warehouses.length > 0, 'nothing was found');
  expect(json.warehouses.every((item) => String(item.Number) === '2'), 'number was not applied: other numbers came back');
  expect(json.warehouses.every((item) => item.CityDescription === 'Бровари'), 'city_name was not applied');
  warehouse = json.warehouses.find((item) => item.CategoryOfWarehouse === 'Branch');
  expect(warehouse, 'branch №2 was not found');
  expect(warehouse.Schedule && warehouse.CityRef && warehouse.SettlementRef, 'the branch lacks Schedule, CityRef or SettlementRef');
  return warehouse.Description;
});

await check('search_warehouses: city_ref, search, type_ref', async () => {
  const { json } = await call('search_warehouses', { city_ref: settlement.DeliveryCity, search: 'Київська', type_ref: lockerType.Ref, limit: 3 });
  expect(json.warehouses.length > 0, 'no parcel lockers found');
  expect(json.warehouses.every((item) => item.TypeOfWarehouse === lockerType.Ref), 'type_ref was not applied');
  expect(json.warehouses.every((item) => item.CityRef === settlement.DeliveryCity), 'city_ref was not applied');
  expect(json.warehouses.every((item) => `${item.Description} ${item.ShortAddress}`.includes('Київськ')), 'search was not applied');
  return `${json.pagination.total} lockers match, e.g. ${json.warehouses[0].ShortAddress}`;
});

await check('search_warehouses: settlement_ref, paging', async () => {
  const first = (await call('search_warehouses', { settlement_ref: settlement.Ref, limit: 2, page: 1 })).json;
  const second = (await call('search_warehouses', { settlement_ref: settlement.Ref, limit: 2, page: 2 })).json;
  expect(first.pagination.next_page === 2, 'no next page');
  expect(first.warehouses[0].Ref !== second.warehouses[0].Ref, 'page 2 repeats page 1');
  expect(first.warehouses.every((item) => item.SettlementRef === settlement.Ref), 'settlement_ref was not applied');
  return `${first.pagination.total} service points in the settlement`;
});

await check('search_warehouses: the largest page the tool asks for (100)', async () => {
  const { json } = await call('search_warehouses', { settlement_ref: settlement.Ref, limit: 100 });
  expect(json.pagination.limit === 100 && json.warehouses.length === 100, `asked for 100, got ${json.warehouses.length}`);
  return `${json.warehouses.length} of ${json.pagination.total}`;
});

await check('search_settlements: the largest page the tool asks for (50)', async () => {
  const { json } = await call('search_settlements', { name: 'нов', limit: 50 });
  expect(json.pagination.limit === 50 && json.settlements.length === 50, `asked for 50, got ${json.settlements.length}`);
  // The API matches former names and districts too ("Звягель, Новоград-Волинський р-н"), so the text is looked for in Present.
  const byName = json.settlements.filter((item) => item.MainDescription.toLowerCase().startsWith('нов')).length;
  expect(byName >= 40, `only ${byName} of 50 names begin with the text`);
  return `${json.settlements.length} of ${json.pagination.total}; ${byName} names begin with the text, the rest match by a former name or district`;
});

await check('search_warehouses: warehouse_ref', async () => {
  const { json } = await call('search_warehouses', { warehouse_ref: warehouse.Ref });
  expect(json.warehouses.length === 1 && json.warehouses[0].Ref === warehouse.Ref, 'expected exactly that branch');
  return json.warehouses[0].ShortAddress;
});

await check('search_streets: settlement_ref, name, limit', async () => {
  const { json } = await call('search_streets', { settlement_ref: settlement.Ref, name: 'Київ', limit: 2 });
  expect(json.streets.length > 0 && json.streets[0].SettlementStreetRef, 'no streets found');
  expect(json.streets.every((street) => street.SettlementRef === settlement.Ref), 'settlement_ref was not applied');
  expect(json.streets.every((street) => street.Present.includes('Київ')), 'name was not applied');
  return json.streets.map((street) => street.Present).join(', ');
});

await check('search_streets: limit is applied, up to the largest the tool asks for (50)', async () => {
  const one = (await call('search_streets', { settlement_ref: settlement.Ref, name: 'ки', limit: 1 })).json;
  const many = (await call('search_streets', { settlement_ref: settlement.Ref, name: 'ки', limit: 50 })).json;
  expect(one.streets.length === 1 && one.total > 1, `limit 1 returned ${one.streets.length} of ${one.total}`);
  expect(many.streets.length === many.total && many.streets.length > 1, `limit 50 returned ${many.streets.length} of ${many.total}`);
  return `limit 1 gives 1 of ${one.total}, limit 50 gives all ${many.streets.length}`;
});

let kyiv;
await check('search_settlements: the city used as the sender', async () => {
  const { json } = await call('search_settlements', { name: 'Київ', limit: 1 });
  kyiv = json.settlements[0];
  expect(kyiv?.MainDescription === 'Київ', 'Kyiv is not the first match');
  return kyiv.Present;
});

await check('estimate_delivery_cost: every argument', async () => {
  const { json } = await call('estimate_delivery_cost', {
    city_sender_ref: kyiv.DeliveryCity,
    city_recipient_ref: settlement.DeliveryCity,
    weight_kg: 2.5,
    service_type: 'WarehouseDoors',
    cargo_type: 'Parcel',
    declared_value: 1500,
    seats: 2,
    volume_m3: 0.02,
    cash_on_delivery: 1500,
  });
  expect(typeof json.Cost === 'number' && json.Cost > 0, 'no Cost');
  expect(json.AssessedCost === 1500, `AssessedCost is ${json.AssessedCost}`);
  expect(typeof json.CostRedelivery === 'number', 'no CostRedelivery');
  return `Cost ${json.Cost}, CostRedelivery ${json.CostRedelivery} ${json.currency}`;
});

await check('estimate_delivery_cost: the minimum of arguments', async () => {
  const { json } = await call('estimate_delivery_cost', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, weight_kg: 1 });
  expect(typeof json.Cost === 'number' && json.Cost > 0, 'no Cost');
  return `Cost ${json.Cost} ${json.currency}, AssessedCost ${json.AssessedCost}`;
});

const SERVICE_TYPES = ['WarehouseWarehouse', 'WarehouseDoors', 'DoorsWarehouse', 'DoorsDoors', 'WarehousePostomat', 'DoorsPostomat'];
const CARGO_TYPES = ['Parcel', 'Cargo', 'Documents'];

await check('estimate_delivery_cost: every service type is accepted', async () => {
  const costs = [];
  for (const service_type of SERVICE_TYPES) {
    const result = await call('estimate_delivery_cost', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, weight_kg: 1, service_type });
    expect(!result.isError, `${service_type}: ${result.text}`);
    expect(typeof result.json.Cost === 'number' && result.json.Cost > 0, `${service_type}: no Cost`);
    costs.push(`${service_type} ${result.json.Cost}`);
  }
  expect(new Set(costs.map((line) => line.split(' ')[1])).size > 1, 'service_type has no effect on the cost');
  return costs.join(', ');
});

await check('estimate_delivery_cost: every cargo type is accepted', async () => {
  const costs = [];
  for (const cargo_type of CARGO_TYPES) {
    const result = await call('estimate_delivery_cost', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, weight_kg: 1, cargo_type });
    expect(!result.isError, `${cargo_type}: ${result.text}`);
    expect(typeof result.json.Cost === 'number' && result.json.Cost > 0, `${cargo_type}: no Cost`);
    costs.push(`${cargo_type} ${result.json.Cost}${result.json.warnings ? ` (${result.json.warnings.join('; ')})` : ''}`);
  }
  return costs.join(', ');
});

await check('estimate_delivery_cost: tyres and pallets are not offered, because the API wants their sizes', async () => {
  const { tools } = await client.listTools();
  const offered = tools.find((tool) => tool.name === 'estimate_delivery_cost').inputSchema.properties.cargo_type.enum;
  expect(JSON.stringify(offered) === JSON.stringify(CARGO_TYPES), `the tool offers ${JSON.stringify(offered)}`);
  return `the tool offers ${offered.join(', ')}`;
});

await check('estimate_delivery_cost: weight and seats change the result', async () => {
  const price = async (extra) => (await call('estimate_delivery_cost', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, ...extra })).json.Cost;
  const light = await price({ weight_kg: 1 });
  const heavy = await price({ weight_kg: 25 });
  const twoSeats = await price({ weight_kg: 25, seats: 2 });
  expect(heavy > light, `25 kg costs ${heavy}, 1 kg costs ${light}`);
  return `1 kg ${light}, 25 kg ${heavy}, 25 kg in 2 seats ${twoSeats}`;
});

await check('estimate_delivery_date: every service type is accepted', async () => {
  const dates = [];
  for (const service_type of SERVICE_TYPES) {
    const result = await call('estimate_delivery_date', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, service_type });
    expect(!result.isError, `${service_type}: ${result.text}`);
    expect(/^\d{4}-\d{2}-\d{2} /.test(result.json.delivery_date), `${service_type}: ${result.json.delivery_date}`);
    dates.push(`${service_type} ${result.json.delivery_date.slice(5, 16)}`);
  }
  return dates.join(', ');
});

await check('estimate_delivery_date: send_date, service_type', async () => {
  const sendDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const { json } = await call('estimate_delivery_date', {
    city_sender_ref: kyiv.DeliveryCity,
    city_recipient_ref: settlement.DeliveryCity,
    service_type: 'WarehouseWarehouse',
    send_date: sendDate,
  });
  expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(json.delivery_date), `delivery_date is ${json.delivery_date}`);
  expect(json.delivery_date.slice(0, 10) >= sendDate, 'the parcel arrives before it is sent');
  return `sent ${sendDate}, arrives ${json.delivery_date} (${json.timezone})`;
});

await check('estimate_delivery_date: counted from now', async () => {
  const { json } = await call('estimate_delivery_date', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity });
  expect(/^\d{4}-\d{2}-\d{2} /.test(json.delivery_date), `delivery_date is ${json.delivery_date}`);
  return `${json.delivery_date}; warnings: ${JSON.stringify(json.warnings ?? [])}`;
});

await check('track_parcels: a number nobody has, with a phone', async () => {
  const { json } = await call('track_parcels', { numbers: [`${UNKNOWN_NUMBER.slice(0, 4)} ${UNKNOWN_NUMBER.slice(4)}`], phone: '+380 50 123 45 67' });
  expect(json.returned === 1, `returned ${json.returned}`);
  const [parcel] = json.parcels;
  expect(parcel.Number === UNKNOWN_NUMBER && parcel.found === false && parcel.StatusCode === '3', JSON.stringify(parcel));
  return `${parcel.Number}: ${parcel.Status}`;
});

await check('track_parcels: a malformed number is refused by the API with a hint', async () => {
  const result = await call('track_parcels', { numbers: ['12345678'] });
  expect(result.isError && result.text.includes('14 digits'), result.text);
  return result.text.split('\n')[0];
});

await client.close();
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
