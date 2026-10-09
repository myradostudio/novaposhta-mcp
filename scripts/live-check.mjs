// Runs every tool of the built server against the real Nova Poshta API.
//
// The unit tests replace the API with a stand-in; this script is the other half:
// it starts dist/index.js the way an MCP host does and calls each tool with every
// argument it has, so that every property the server can send is sent at least
// once. It reads public directories and asks for calculations only. The waybill
// number it tracks by default is made up and comes back as "not found".
//
// Usage:
//   npm run live-check                        without a key (public methods)
//   npm run live-check:key                    asks for your key and, optionally, a waybill of your own
//   node scripts/live-check.mjs [--ask-key] [--ask-waybill]
//
//   --ask-key      asks for the API key; the input is hidden. Without the flag the
//                  key is taken from NOVAPOSHTA_API_KEY, and the check runs without
//                  a key when that is not set.
//   --ask-waybill  asks for the number of a real waybill and the phone of its sender
//                  or recipient, both hidden, and tracks that parcel. Of the answer
//                  only the names of the fields are printed: no number, no phone,
//                  no name, no address, no status.
//
// Nothing that is typed is echoed or printed, and the key goes to the server
// through its environment, not through a command line.
//
// It needs the network, so it is not part of `npm test` or of CI; the tests run
// this script against a local stand-in instead (tests/live-check.test.ts).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { createPrompter, createReporter, exitAfterOutput, expect, Interrupted, need } from './live-check-io.mjs';

const SERVER_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const UNKNOWN_NUMBER = '20400000000000';
const FLAGS = ['--ask-key', '--ask-waybill'];
/** What Nova Poshta adds to a tracking answer for the phone of a participant: the people of the parcel. */
const PERSONAL_FIELDS = [
  'SenderFullNameEW',
  'CounterpartySenderDescription',
  'PhoneSender',
  'SenderAddress',
  'RecipientFullName',
  'RecipientFullNameEW',
  'CounterpartyRecipientDescription',
  'PhoneRecipient',
  'RecipientAddress',
];

const report = createReporter();
const prompt = createPrompter();

/** Ends the run before anything is sent: a mistake in how the script was started. */
async function refuse(message) {
  report.say(message);
  await exitAfterOutput(2);
}

const flags = process.argv.slice(2);
if (flags.some((flag) => !FLAGS.includes(flag))) {
  // What was passed is not repeated: it may be a key put on the command line by mistake.
  await refuse(`The script takes only ${FLAGS.join(' and ')}. A key is never passed on the command line: --ask-key asks for it.`);
}
if (!existsSync(SERVER_ENTRY)) await refuse('dist/index.js is missing. Run `npm run build` first, or start the check with `npm run live-check`.');

/** People paste numbers as "2045 0000 0000 00" and phones as "+380 (50) 123-45-67". */
const withoutSeparators = (value) => value.replace(/[\s()+-]/g, '');

let apiKey = (process.env.NOVAPOSHTA_API_KEY ?? '').trim();
let waybill;
let waybillAsked = false;
try {
  if (flags.includes('--ask-key')) {
    apiKey = await prompt.secret('Nova Poshta API key (input is hidden; Enter to run without a key): ');
  }
  if (flags.includes('--ask-waybill')) {
    waybillAsked = true;
    const number = withoutSeparators(await prompt.secret('Waybill number of a parcel of your own (input is hidden; Enter to skip): '));
    if (number !== '') {
      if (!/^[A-Za-z0-9]{6,30}$/.test(number)) await refuse('That is not a waybill number: 6 to 30 letters and digits are expected, 14 digits as a rule.');
      const phone = withoutSeparators(await prompt.secret('Phone of its sender or recipient (input is hidden; Enter to track without a phone): '));
      if (phone !== '' && !/^\d{10,15}$/.test(phone)) await refuse('That is not a phone number: 10 to 15 digits are expected, for example 380501234567.');
      waybill = { number, phone };
      // The API repeats the number in its remarks, and it may write the phone without the country code.
      report.hide(number, phone, phone.slice(-10), phone.slice(-9));
    }
  }
} catch (error) {
  if (error instanceof Interrupted) process.exit(130);
  throw error;
}
report.hide(apiKey);

const env = { ...getDefaultEnvironment() };
if (apiKey) env.NOVAPOSHTA_API_KEY = apiKey;
if (process.env.NOVAPOSHTA_API_URL) env.NOVAPOSHTA_API_URL = process.env.NOVAPOSHTA_API_URL;

const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], env, stderr: 'pipe' });
let serverLog = '';
transport.stderr?.on('data', (chunk) => (serverLog += chunk));
const client = new Client({ name: 'live-check', version: '1.0.0' });
try {
  await client.connect(transport);
} catch (error) {
  // A key with a space in it, for example: the server explains on stderr why it refused to start.
  report.say('The server did not start.');
  report.say(serverLog.trim() || (error instanceof Error ? error.message : String(error)));
  await exitAfterOutput(1);
}

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  const isError = result.isError === true;
  return {
    isError,
    text,
    // A check that reads the data of a refused call fails with the words of the refusal.
    get json() {
      if (isError) throw new Error(text);
      return JSON.parse(text.slice(text.search(/^[{[]/m)));
    },
  };
}

report.say(
  `Nova Poshta live check, ${new Date().toISOString().slice(0, 10)}, ${apiKey ? 'with an API key' : 'without an API key'}${waybill ? ', with a waybill of your own' : ''}`,
);

let settlement;
let warehouse;
let lockerType;

await report.check('search_settlements: name, limit, page', async () => {
  const { json } = await call('search_settlements', { name: 'Бровари', limit: 2, page: 1 });
  settlement = json.settlements.find((item) => item.Area === 'Київська');
  expect(settlement, 'Brovary of Kyiv region was not found');
  expect(/^[0-9a-f-]{36}$/.test(settlement.Ref) && /^[0-9a-f-]{36}$/.test(settlement.DeliveryCity), 'no Ref or DeliveryCity');
  expect(json.pagination.total >= json.pagination.returned, 'pagination total is missing');
  return `${settlement.Present}; ${json.pagination.total} matches`;
});

await report.check('search_settlements: a Latin name is refused with a hint', async () => {
  const result = await call('search_settlements', { name: 'Kyiv' });
  expect(result.isError, 'expected an error');
  expect(result.text.includes('Ukrainian letters'), `no hint in: ${result.text}`);
  return result.text.split('\n')[0];
});

await report.check('list_warehouse_types', async () => {
  const { json } = await call('list_warehouse_types', {});
  lockerType = json.types.find((type) => type.Description === 'Поштомат');
  expect(json.types.length >= 3 && lockerType, 'no "Поштомат" type');
  return `${json.types.length} types`;
});

await report.check('search_warehouses: city_name, number', async () => {
  const { json } = await call('search_warehouses', { city_name: 'Бровари', number: 2, limit: 5, page: 1 });
  expect(json.warehouses.length > 0, 'nothing was found');
  expect(json.warehouses.every((item) => String(item.Number) === '2'), 'number was not applied: other numbers came back');
  expect(json.warehouses.every((item) => item.CityDescription === 'Бровари'), 'city_name was not applied');
  warehouse = json.warehouses.find((item) => item.CategoryOfWarehouse === 'Branch');
  expect(warehouse, 'branch №2 was not found');
  expect(warehouse.Schedule && warehouse.CityRef && warehouse.SettlementRef, 'the branch lacks Schedule, CityRef or SettlementRef');
  return warehouse.Description;
});

await report.check('search_warehouses: city_ref, search, type_ref', async () => {
  need(settlement, 'the settlement of the first check');
  need(lockerType, 'the type of a parcel locker');
  const { json } = await call('search_warehouses', { city_ref: settlement.DeliveryCity, search: 'Київська', type_ref: lockerType.Ref, limit: 3 });
  expect(json.warehouses.length > 0, 'no parcel lockers found');
  expect(json.warehouses.every((item) => item.TypeOfWarehouse === lockerType.Ref), 'type_ref was not applied');
  expect(json.warehouses.every((item) => item.CityRef === settlement.DeliveryCity), 'city_ref was not applied');
  expect(json.warehouses.every((item) => `${item.Description} ${item.ShortAddress}`.includes('Київськ')), 'search was not applied');
  return `${json.pagination.total} lockers match, e.g. ${json.warehouses[0].ShortAddress}`;
});

await report.check('search_warehouses: settlement_ref, paging', async () => {
  need(settlement, 'the settlement of the first check');
  const first = (await call('search_warehouses', { settlement_ref: settlement.Ref, limit: 2, page: 1 })).json;
  const second = (await call('search_warehouses', { settlement_ref: settlement.Ref, limit: 2, page: 2 })).json;
  expect(first.pagination.next_page === 2, 'no next page');
  expect(first.warehouses[0].Ref !== second.warehouses[0].Ref, 'page 2 repeats page 1');
  expect(first.warehouses.every((item) => item.SettlementRef === settlement.Ref), 'settlement_ref was not applied');
  return `${first.pagination.total} service points in the settlement`;
});

await report.check('search_warehouses: the largest page the tool asks for (100)', async () => {
  need(settlement, 'the settlement of the first check');
  const { json } = await call('search_warehouses', { settlement_ref: settlement.Ref, limit: 100 });
  expect(json.pagination.limit === 100 && json.warehouses.length === 100, `asked for 100, got ${json.warehouses.length}`);
  return `${json.warehouses.length} of ${json.pagination.total}`;
});

await report.check('search_settlements: the largest page the tool asks for (50)', async () => {
  const { json } = await call('search_settlements', { name: 'нов', limit: 50 });
  expect(json.pagination.limit === 50 && json.settlements.length === 50, `asked for 50, got ${json.settlements.length}`);
  // The API matches former names and districts too ("Звягель, Новоград-Волинський р-н"), so the text is looked for in Present.
  const byName = json.settlements.filter((item) => item.MainDescription.toLowerCase().startsWith('нов')).length;
  expect(byName >= 40, `only ${byName} of 50 names begin with the text`);
  return `${json.settlements.length} of ${json.pagination.total}; ${byName} names begin with the text, the rest match by a former name or district`;
});

await report.check('search_warehouses: warehouse_ref', async () => {
  need(warehouse, 'the branch found by its number');
  const { json } = await call('search_warehouses', { warehouse_ref: warehouse.Ref });
  expect(json.warehouses.length === 1 && json.warehouses[0].Ref === warehouse.Ref, 'expected exactly that branch');
  return json.warehouses[0].ShortAddress;
});

await report.check('search_streets: settlement_ref, name, limit', async () => {
  need(settlement, 'the settlement of the first check');
  const { json } = await call('search_streets', { settlement_ref: settlement.Ref, name: 'Київ', limit: 2 });
  expect(json.streets.length > 0 && json.streets[0].SettlementStreetRef, 'no streets found');
  expect(json.streets.every((street) => street.SettlementRef === settlement.Ref), 'settlement_ref was not applied');
  expect(json.streets.every((street) => street.Present.includes('Київ')), 'name was not applied');
  return json.streets.map((street) => street.Present).join(', ');
});

await report.check('search_streets: limit is applied, up to the largest the tool asks for (50)', async () => {
  need(settlement, 'the settlement of the first check');
  const one = (await call('search_streets', { settlement_ref: settlement.Ref, name: 'ки', limit: 1 })).json;
  const many = (await call('search_streets', { settlement_ref: settlement.Ref, name: 'ки', limit: 50 })).json;
  expect(one.streets.length === 1 && one.total > 1, `limit 1 returned ${one.streets.length} of ${one.total}`);
  expect(many.streets.length === many.total && many.streets.length > 1, `limit 50 returned ${many.streets.length} of ${many.total}`);
  return `limit 1 gives 1 of ${one.total}, limit 50 gives all ${many.streets.length}`;
});

let kyiv;
await report.check('search_settlements: the city used as the sender', async () => {
  const { json } = await call('search_settlements', { name: 'Київ', limit: 1 });
  kyiv = json.settlements[0];
  expect(kyiv?.MainDescription === 'Київ', 'Kyiv is not the first match');
  return kyiv.Present;
});

await report.check('estimate_delivery_cost: every argument', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
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

await report.check('estimate_delivery_cost: the minimum of arguments', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
  const { json } = await call('estimate_delivery_cost', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, weight_kg: 1 });
  expect(typeof json.Cost === 'number' && json.Cost > 0, 'no Cost');
  return `Cost ${json.Cost} ${json.currency}, AssessedCost ${json.AssessedCost}`;
});

const SERVICE_TYPES = ['WarehouseWarehouse', 'WarehouseDoors', 'DoorsWarehouse', 'DoorsDoors', 'WarehousePostomat', 'DoorsPostomat'];
const CARGO_TYPES = ['Parcel', 'Cargo', 'Documents'];

await report.check('estimate_delivery_cost: every service type is accepted', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
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

await report.check('estimate_delivery_cost: every cargo type is accepted', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
  const costs = [];
  for (const cargo_type of CARGO_TYPES) {
    const result = await call('estimate_delivery_cost', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, weight_kg: 1, cargo_type });
    expect(!result.isError, `${cargo_type}: ${result.text}`);
    expect(typeof result.json.Cost === 'number' && result.json.Cost > 0, `${cargo_type}: no Cost`);
    costs.push(`${cargo_type} ${result.json.Cost}${result.json.warnings ? ` (${result.json.warnings.join('; ')})` : ''}`);
  }
  return costs.join(', ');
});

await report.check('estimate_delivery_cost: tyres and pallets are not offered, because the API wants their sizes', async () => {
  const { tools } = await client.listTools();
  const offered = tools.find((tool) => tool.name === 'estimate_delivery_cost').inputSchema.properties.cargo_type.enum;
  expect(JSON.stringify(offered) === JSON.stringify(CARGO_TYPES), `the tool offers ${JSON.stringify(offered)}`);
  return `the tool offers ${offered.join(', ')}`;
});

await report.check('estimate_delivery_cost: weight and seats change the result', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
  const price = async (extra) => (await call('estimate_delivery_cost', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, ...extra })).json.Cost;
  const light = await price({ weight_kg: 1 });
  const heavy = await price({ weight_kg: 25 });
  const twoSeats = await price({ weight_kg: 25, seats: 2 });
  expect(heavy > light, `25 kg costs ${heavy}, 1 kg costs ${light}`);
  return `1 kg ${light}, 25 kg ${heavy}, 25 kg in 2 seats ${twoSeats}`;
});

await report.check('estimate_delivery_date: every service type is accepted', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
  const dates = [];
  for (const service_type of SERVICE_TYPES) {
    const result = await call('estimate_delivery_date', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity, service_type });
    expect(!result.isError, `${service_type}: ${result.text}`);
    expect(/^\d{4}-\d{2}-\d{2} /.test(result.json.delivery_date), `${service_type}: ${result.json.delivery_date}`);
    dates.push(`${service_type} ${result.json.delivery_date.slice(5, 16)}`);
  }
  return dates.join(', ');
});

await report.check('estimate_delivery_date: send_date, service_type', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
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

await report.check('estimate_delivery_date: counted from now', async () => {
  need(kyiv, 'the city used as the sender');
  need(settlement, 'the settlement of the first check');
  const { json } = await call('estimate_delivery_date', { city_sender_ref: kyiv.DeliveryCity, city_recipient_ref: settlement.DeliveryCity });
  expect(/^\d{4}-\d{2}-\d{2} /.test(json.delivery_date), `delivery_date is ${json.delivery_date}`);
  return `${json.delivery_date}; warnings: ${JSON.stringify(json.warnings ?? [])}`;
});

await report.check('track_parcels: a number nobody has, with a phone', async () => {
  const { json } = await call('track_parcels', { numbers: [`${UNKNOWN_NUMBER.slice(0, 4)} ${UNKNOWN_NUMBER.slice(4)}`], phone: '+380 50 123 45 67' });
  expect(json.returned === 1, `returned ${json.returned}`);
  const [parcel] = json.parcels;
  expect(parcel.Number === UNKNOWN_NUMBER && parcel.found === false && parcel.StatusCode === '3', JSON.stringify(parcel));
  return `${parcel.Number}: ${parcel.Status}`;
});

await report.check('track_parcels: a malformed number is refused by the API with a hint', async () => {
  const result = await call('track_parcels', { numbers: ['12345678'] });
  expect(result.isError && result.text.includes('14 digits'), result.text);
  return result.text.split('\n')[0];
});

// A waybill of the person who runs the check. The lines below name fields and say whether the check passed;
// they never carry a value of the parcel.
if (waybillAsked && waybill === undefined) {
  report.skip('track_parcels: a waybill of your own', 'no number was given');
}

if (waybill !== undefined) {
  const names = (parcel) => Object.keys(parcel).filter((name) => name !== 'found');
  const personal = (parcel) => PERSONAL_FIELDS.filter((name) => name in parcel);
  /** Tracks the one waybill and returns its record, after the checks every variant shares. */
  const track = async (extra) => {
    const result = await call('track_parcels', { numbers: [waybill.number], ...extra });
    expect(!result.isError, result.text.split('\n')[0]);
    const [parcel] = result.json.parcels;
    expect(result.json.returned === 1 && parcel !== undefined, `${result.json.returned} parcels came back for one number`);
    expect(parcel.Number === waybill.number, 'the answer is about another number');
    expect(parcel.found === true, 'Nova Poshta does not know this number');
    return parcel;
  };

  let withoutPhone;
  let withPhone;

  await report.check('track_parcels: a waybill of your own, without a phone', async () => {
    withoutPhone = await track({});
    return `found; fields: ${names(withoutPhone).join(', ')}; of people: ${personal(withoutPhone).join(', ') || 'none'}`;
  });

  if (waybill.phone === '') {
    report.skip('track_parcels: the same waybill with the phone of a participant', 'no phone was given');
  } else {
    await report.check('track_parcels: the same waybill with the phone of a participant', async () => {
      need(withoutPhone, 'the parcel');
      const parcel = await track({ phone: waybill.phone });
      expect(
        personal(parcel).length > 0,
        'the phone added no names, phones or addresses: Nova Poshta adds them only for the phone of the sender or the recipient of this waybill',
      );
      withPhone = parcel;
      const added = names(parcel).filter((name) => !(name in withoutPhone));
      return `found; of people: ${personal(parcel).join(', ')}; the phone added: ${added.join(', ') || 'nothing'}`;
    });
  }

  await report.check('track_parcels: all_fields returns what the compact view leaves out', async () => {
    const compact = need(withPhone ?? withoutPhone, 'the parcel');
    const full = await track({ ...(withPhone === undefined ? {} : { phone: waybill.phone }), all_fields: true });
    const lost = names(compact).filter((name) => !(name in full));
    expect(lost.length === 0, `the full view lacks fields of the compact one: ${lost.join(', ')}`);
    const extra = names(full).filter((name) => !(name in compact));
    return `${names(full).length} fields against ${names(compact).length}; only in the full view: ${extra.join(', ') || 'none'}`;
  });
}

await client.close();
await exitAfterOutput(report.finish());
