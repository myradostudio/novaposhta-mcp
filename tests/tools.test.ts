/**
 * The tools, called through a real MCP client. Every request the server sends
 * is checked against the contract confirmed on the live API.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { assertMatchesContract } from './support/contract.js';
import { failure, ok } from './support/fake-api.js';
import * as fixtures from './support/fixtures.js';
import { NUMBERS, REFS } from './support/fixtures.js';
import { API_KEY, createHarness, type Harness } from './support/harness.js';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** The single request of the test, already checked against the contract. */
function sent(h: Harness) {
  const request = h.api.single;
  return { called: assertMatchesContract(request, h.config.apiKey ?? ''), properties: request.properties };
}

describe('track_parcels', () => {
  it('returns the public status of a parcel in compact form', async () => {
    harness = await createHarness();
    harness.api.on(
      'TrackingDocument.getStatusDocuments',
      ok([fixtures.deliveredParcel], { warnings: [fixtures.phoneReminder(NUMBERS.delivered)] }),
    );

    const result = await harness.callJson('track_parcels', { numbers: [NUMBERS.delivered] });

    const { called, properties } = sent(harness);
    assert.equal(called, 'TrackingDocument.getStatusDocuments');
    assert.deepEqual(properties, { Documents: [{ DocumentNumber: NUMBERS.delivered, Phone: '' }] });
    assert.deepEqual(result, {
      returned: 1,
      parcels: [
        {
          found: true,
          Number: NUMBERS.delivered,
          StatusCode: '9',
          Status: 'Відправлення отримано',
          DateCreated: '01-10-2026 19:18:12',
          ScheduledDeliveryDate: '02-10-2026 08:02:03',
          ActualDeliveryDate: '2026-10-02 08:02:03',
          RecipientDateTime: '04.10.2026 08:10:48',
          TrackingUpdateDate: '2026-10-04 08:10:51',
          CitySender: 'Житомир',
          WarehouseSender: 'Відділення №1: вул. Прикладна, 1',
          CityRecipient: 'Бровари',
          WarehouseRecipient: 'Відділення №2 (до 30 кг на одне місце): вул. Київська, 302',
          WarehouseRecipientNumber: 2,
          CategoryOfWarehouse: 'Branch',
          ServiceType: 'WarehouseWarehouse',
          CargoType: 'Parcel',
          SeatsAmount: '1',
          DocumentWeight: 5.47,
          FactualWeight: '2.10',
          VolumeWeight: '5.47',
          DocumentCost: '135',
          PayerType: 'Recipient',
          PaymentMethod: 'Cash',
          PaymentStatus: 'PAYED',
          AmountPaid: '135',
        },
      ],
    });
  });

  it('says found: false for a number Nova Poshta does not know, and little else', async () => {
    harness = await createHarness();
    harness.api.on('TrackingDocument.getStatusDocuments', ok([fixtures.unknownParcel]));

    const result = await harness.callJson('track_parcels', { numbers: [NUMBERS.unknown] });

    assert.deepEqual(result.parcels, [{ found: false, Number: NUMBERS.unknown, StatusCode: '3', Status: 'Номер не знайдено' }]);
  });

  it('removes separators from numbers and the phone, and tracks each number once', async () => {
    harness = await createHarness();
    harness.api.on('TrackingDocument.getStatusDocuments', ok([fixtures.deliveredParcelWithPeople, fixtures.unknownParcel]));

    const result = await harness.callJson('track_parcels', {
      numbers: ['2045 0000 0000 01', '20450000000001', '2040-0000-0000-00'],
      phone: '+380 (50) 123-45-67',
    });

    const { properties } = sent(harness);
    assert.deepEqual(properties, {
      Documents: [
        { DocumentNumber: NUMBERS.delivered, Phone: '380501234567' },
        { DocumentNumber: NUMBERS.unknown, Phone: '380501234567' },
      ],
    });
    assert.equal(result.returned, 2);
    assert.equal(result.parcels[0].RecipientFullName, 'Тестова Ірина', 'the people are shown once Nova Poshta sends them');
    assert.equal(result.parcels[0].PhoneSender, '380441234567');
  });

  it('keeps the remarks of the API except the repeated reminder about the phone', async () => {
    harness = await createHarness();
    harness.api.on(
      'TrackingDocument.getStatusDocuments',
      ok([fixtures.unknownParcel], { warnings: ['Invalid DocumentNumber: 12345678', fixtures.phoneReminder(NUMBERS.unknown)] }),
    );

    const result = await harness.callJson('track_parcels', { numbers: [NUMBERS.unknown, '12345678'] });

    assert.deepEqual(result.warnings, ['Invalid DocumentNumber: 12345678']);
  });

  it('does not lose a remark behind a hundred reminders', async () => {
    harness = await createHarness();
    const numbers = Array.from({ length: 100 }, (_, index) => String(20450000000000 + index));
    harness.api.on(
      'TrackingDocument.getStatusDocuments',
      // The remark that matters comes last, after one reminder per number.
      ok([fixtures.unknownParcel], { warnings: [...numbers.map(fixtures.phoneReminder), 'Invalid DocumentNumber: 12345678'] }),
    );

    const result = await harness.callJson('track_parcels', { numbers: [...numbers.slice(0, 99), '12345678'] });

    assert.deepEqual(result.warnings, ['Invalid DocumentNumber: 12345678']);
  });

  it('keeps the reminder when a phone was given: it then means the phone did not fit', async () => {
    harness = await createHarness();
    harness.api.on('TrackingDocument.getStatusDocuments', ok([fixtures.deliveredParcel], { warnings: [fixtures.phoneReminder(NUMBERS.delivered)] }));

    const result = await harness.callJson('track_parcels', { numbers: [NUMBERS.delivered], phone: '380501234567' });

    assert.deepEqual(result.warnings, [`${NUMBERS.delivered}: Please enter a valid phone number from the express invoice to show full information`]);
  });

  it('does not guess whether a parcel was found when the answer has no status code', async () => {
    harness = await createHarness();
    harness.api.on('TrackingDocument.getStatusDocuments', ok([{ Number: NUMBERS.delivered, Status: 'У дорозі' }, { Number: NUMBERS.unknown, StatusCode: 3 }]));

    const { parcels } = await harness.callJson('track_parcels', { numbers: [NUMBERS.delivered, NUMBERS.unknown] });

    assert.deepEqual(parcels, [
      { Number: NUMBERS.delivered, Status: 'У дорозі' },
      { found: false, Number: NUMBERS.unknown, StatusCode: 3 },
    ]);
  });

  it('returns every field that carries a value with all_fields', async () => {
    harness = await createHarness();
    harness.api.on('TrackingDocument.getStatusDocuments', ok([fixtures.deliveredParcel]));

    const { parcels } = await harness.callJson('track_parcels', { numbers: [NUMBERS.delivered], all_fields: true });

    assert.equal(parcels[0].CounterpartySenderType, 'PrivatePerson');
    assert.equal(parcels[0].CheckWeight, 6.52);
    assert.equal(parcels[0].Edit, true);
    assert.equal('PhoneSender' in parcels[0], false, 'empty fields stay out');
    assert.equal('Redelivery' in parcels[0], false, 'zero fields stay out');
    assert.equal('CargoReturnRefusal' in parcels[0], false, 'false fields stay out');
  });

  it('sends the configured key with the request', async () => {
    harness = await createHarness({ apiKey: API_KEY });
    harness.api.on('TrackingDocument.getStatusDocuments', ok([fixtures.unknownParcel]));

    await harness.callJson('track_parcels', { numbers: [NUMBERS.unknown] });

    sent(harness);
    assert.equal(harness.api.single.body['apiKey'], API_KEY);
  });

  it('passes the refusal of the API on with a hint about the number', async () => {
    harness = await createHarness();
    harness.api.on('TrackingDocument.getStatusDocuments', failure(['Document number is not correct'], ['20001401442']));

    const result = await harness.call('track_parcels', { numbers: ['12345678'] });

    assert.equal(result.isError, true);
    assert.match(result.text, /^Nova Poshta API error: Document number is not correct\n.*14 digits/);
  });

  it('accepts at most a hundred numbers and no stray characters', async () => {
    harness = await createHarness();
    const many = Array.from({ length: 101 }, (_, index) => String(20450000000000 + index));

    for (const args of [{ numbers: many }, { numbers: [] }, { numbers: ['2045/0000'] }, { numbers: [NUMBERS.unknown], phone: 'call me' }, {}]) {
      const result = await harness.call('track_parcels', args);
      assert.equal(result.isError, true, JSON.stringify(args).slice(0, 60));
    }
    assert.equal(harness.api.requests.length, 0);
  });

  it('counts digits, not separators: a row of dashes is neither a number nor a phone', async () => {
    harness = await createHarness();
    const invalid: Record<string, unknown>[] = [
      { numbers: ['2 - - - - - - -'] },
      { numbers: ['12345'] },
      { numbers: [NUMBERS.unknown], phone: '----------' },
      { numbers: [NUMBERS.unknown], phone: '((((((((((' },
      { numbers: [NUMBERS.unknown], phone: '380 50 123' },
      { numbers: [NUMBERS.unknown], phone: '+3805012345678901' },
    ];

    for (const args of invalid) {
      const result = await harness.call('track_parcels', args);
      assert.equal(result.isError, true, JSON.stringify(args));
    }
    assert.equal(harness.api.requests.length, 0, 'a phone that is not one must not turn into a search without a phone');
  });
});

describe('search_settlements', () => {
  it('returns settlements with both identifiers and a pagination block', async () => {
    harness = await createHarness();
    harness.api.on('Address.searchSettlements', ok([fixtures.settlements]));

    const result = await harness.callJson('search_settlements', { name: ' Бровари ' });

    const { called, properties } = sent(harness);
    assert.equal(called, 'Address.searchSettlements');
    assert.deepEqual(properties, { CityName: 'Бровари', Limit: 10, Page: 1 });
    assert.deepEqual(result, {
      pagination: { page: 1, limit: 10, returned: 2, total: 3, next_page: 2 },
      settlements: [
        {
          Present: 'м. Бровари, Броварський р-н, Київська обл.',
          MainDescription: 'Бровари',
          Area: 'Київська',
          Region: 'Броварський',
          SettlementTypeCode: 'м.',
          Ref: REFS.brovarySettlement,
          DeliveryCity: REFS.brovaryCity,
          Warehouses: 610,
          AddressDeliveryAllowed: true,
          StreetsAvailability: true,
        },
        {
          Present: 'с. Броварі, Бучацький р-н, Тернопільська обл.',
          MainDescription: 'Броварі',
          Area: 'Тернопільська',
          Region: 'Бучацький',
          SettlementTypeCode: 'с.',
          Ref: '0eb7e688-4b3a-11e4-ab6d-005056801329',
          DeliveryCity: '06f878fe-4079-11de-b509-001d92f78698',
          // A village with no branches and no street directory: 0 and false are answers and are kept.
          Warehouses: 0,
          AddressDeliveryAllowed: true,
          StreetsAvailability: false,
        },
      ],
    });
  });

  it('pages and clamps the page size', async () => {
    harness = await createHarness();
    harness.api.on('Address.searchSettlements', ok([{ TotalCount: 1217, Addresses: fixtures.settlements.Addresses }]));

    const result = await harness.callJson('search_settlements', { name: 'нов', limit: 500, page: 3 });

    assert.deepEqual(sent(harness).properties, { CityName: 'нов', Limit: 50, Page: 3 });
    assert.deepEqual(result.pagination, { page: 3, limit: 50, returned: 2, total: 1217, next_page: 4 });
  });

  it('answers an empty search with an empty list', async () => {
    harness = await createHarness();
    harness.api.on('Address.searchSettlements', ok([{ TotalCount: 0, Addresses: [] }]));

    const result = await harness.callJson('search_settlements', { name: 'зззз' });

    assert.deepEqual(result, { pagination: { page: 1, limit: 10, returned: 0, total: 0, next_page: null }, settlements: [] });
  });

  it('explains the refusal of a name in Latin letters', async () => {
    harness = await createHarness();
    harness.api.on('Address.searchSettlements', failure(['CityName has invalid characters'], ['20000500652']));

    const result = await harness.call('search_settlements', { name: 'Kyiv' });

    assert.equal(result.isError, true);
    assert.equal(
      result.text,
      'Nova Poshta API error: CityName has invalid characters\nWrite the name in Ukrainian letters: the search does not accept Latin ones.',
    );
  });

  it('needs a name', async () => {
    harness = await createHarness();

    assert.equal((await harness.call('search_settlements', { name: '  ' })).isError, true);
    assert.equal((await harness.call('search_settlements', {})).isError, true);
    assert.equal(harness.api.requests.length, 0);
  });
});

describe('search_warehouses', () => {
  it('finds a branch of a city by its number', async () => {
    harness = await createHarness();
    harness.api.on('AddressGeneral.getWarehouses', ok([fixtures.warehouse], { info: { totalCount: 1 } }));

    const result = await harness.callJson('search_warehouses', { city_name: 'Бровари', number: 2 });

    const { called, properties } = sent(harness);
    assert.equal(called, 'AddressGeneral.getWarehouses');
    assert.deepEqual(properties, { CityName: 'Бровари', WarehouseId: '2', Limit: 20, Page: 1 });
    assert.deepEqual(result, {
      pagination: { page: 1, limit: 20, returned: 1, total: 1, next_page: null },
      warehouses: [
        {
          Ref: REFS.branch,
          Number: '2',
          Description: 'Відділення №2 (до 30 кг на одне місце): вул. Київська, 302',
          ShortAddress: 'Бровари, Київська, 302',
          CategoryOfWarehouse: 'Branch',
          TypeOfWarehouse: REFS.branchType,
          WarehouseStatus: 'Working',
          CityRef: REFS.brovaryCity,
          CityDescription: 'Бровари',
          SettlementRef: REFS.brovarySettlement,
          SettlementDescription: 'Бровари',
          SettlementAreaDescription: 'Київська',
          Phone: '380800500609',
          PostalCodeUA: '07401',
          PlaceMaxWeightAllowed: '30',
          Latitude: '50.518295000000000',
          Longitude: '30.787476000000000',
          Schedule: fixtures.warehouse.Schedule,
        },
      ],
    });
  });

  it('sends every filter under the name the API uses', async () => {
    harness = await createHarness();
    harness.api.on('AddressGeneral.getWarehouses', ok([fixtures.warehouse], { info: { totalCount: 38 } }));

    const result = await harness.callJson('search_warehouses', {
      city_ref: REFS.brovaryCity,
      settlement_ref: REFS.brovarySettlement,
      search: 'Київська',
      type_ref: REFS.lockerType,
      limit: 5,
      page: 2,
    });

    assert.deepEqual(sent(harness).properties, {
      CityRef: REFS.brovaryCity,
      SettlementRef: REFS.brovarySettlement,
      FindByString: 'Київська',
      TypeOfWarehouseRef: REFS.lockerType,
      Limit: 5,
      Page: 2,
    });
    assert.deepEqual(result.pagination, { page: 2, limit: 5, returned: 1, total: 38, next_page: 3 });
  });

  it('asks for one branch by its Ref', async () => {
    harness = await createHarness();
    harness.api.on('AddressGeneral.getWarehouses', ok([fixtures.warehouse], { info: { totalCount: 1 } }));

    await harness.callJson('search_warehouses', { warehouse_ref: REFS.branch });

    assert.deepEqual(sent(harness).properties, { Ref: REFS.branch, Limit: 20, Page: 1 });
  });

  it('refuses to list the whole country', async () => {
    harness = await createHarness();

    const result = await harness.call('search_warehouses', { search: 'Київська', limit: 100 });

    assert.equal(result.isError, true);
    assert.match(result.text, /^Say where to look: pass city_name, city_ref or settlement_ref/);
    assert.equal(harness.api.requests.length, 0);
  });

  it('clamps the page size and derives the next page when there is no total', async () => {
    harness = await createHarness();
    harness.api.on('AddressGeneral.getWarehouses', ok([fixtures.warehouse, fixtures.warehouse]));

    const result = await harness.callJson('search_warehouses', { city_name: 'Київ', limit: 1000 });

    assert.equal(sent(harness).properties['Limit'], 100);
    assert.deepEqual(result.pagination, { page: 1, limit: 100, returned: 2, next_page: null });
  });

  it('rejects an identifier that is not a Ref, and unknown filters', async () => {
    harness = await createHarness();

    for (const args of [{ city_ref: 'Бровари' }, { city_name: 'Бровари', number: 0 }, { city_name: 'Бровари', category: 'Postomat' }]) {
      assert.equal((await harness.call('search_warehouses', args)).isError, true, JSON.stringify(args));
    }
    assert.equal(harness.api.requests.length, 0);
  });
});

describe('list_warehouse_types', () => {
  it('lists the types without the Russian duplicates', async () => {
    harness = await createHarness();
    harness.api.on('AddressGeneral.getWarehouseTypes', ok(fixtures.warehouseTypes));

    const result = await harness.callJson('list_warehouse_types');

    const { called, properties } = sent(harness);
    assert.equal(called, 'AddressGeneral.getWarehouseTypes');
    assert.deepEqual(properties, {});
    assert.equal(result.types.length, 5);
    assert.deepEqual(result.types.at(-1), { Ref: REFS.lockerType, Description: 'Поштомат' });
  });
});

describe('search_streets', () => {
  it('finds streets of a settlement', async () => {
    harness = await createHarness();
    harness.api.on('Address.searchSettlementStreets', ok([fixtures.streets]));

    const result = await harness.callJson('search_streets', { settlement_ref: REFS.brovarySettlement, name: 'Київ', limit: 5 });

    const { called, properties } = sent(harness);
    assert.equal(called, 'Address.searchSettlementStreets');
    assert.deepEqual(properties, { StreetName: 'Київ', SettlementRef: REFS.brovarySettlement, Limit: 5 });
    assert.deepEqual(result, {
      total: 1,
      returned: 1,
      streets: [
        {
          Present: 'вул. Київська',
          SettlementStreetDescription: 'Київська',
          StreetsTypeDescription: 'вул.',
          SettlementStreetRef: REFS.street,
          SettlementRef: REFS.brovarySettlement,
        },
      ],
    });
  });

  it('needs the settlement and at least two letters', async () => {
    harness = await createHarness();

    assert.equal((await harness.call('search_streets', { name: 'Київська' })).isError, true);
    // One letter found nothing on the live API, so it is refused instead of answered with an empty list.
    const oneLetter = await harness.call('search_streets', { settlement_ref: REFS.brovarySettlement, name: 'к' });
    assert.equal(oneLetter.isError, true);
    assert.match(oneLetter.text, /at least two letters/);
    assert.equal(harness.api.requests.length, 0);
  });
});

describe('estimate_delivery_cost', () => {
  const route = { city_sender_ref: REFS.kyivCity, city_recipient_ref: REFS.brovaryCity };

  it('asks for the tariff with the defaults a parcel between branches needs', async () => {
    harness = await createHarness();
    harness.api.on('InternetDocument.getDocumentPrice', ok([{ Cost: 70, AssessedCost: 300 }], { warnings: ['DateTime is set to current'] }));

    const result = await harness.callJson('estimate_delivery_cost', { ...route, weight_kg: 1 });

    const { called, properties } = sent(harness);
    assert.equal(called, 'InternetDocument.getDocumentPrice');
    assert.deepEqual(properties, {
      CitySender: REFS.kyivCity,
      CityRecipient: REFS.brovaryCity,
      Weight: 1,
      ServiceType: 'WarehouseWarehouse',
      CargoType: 'Parcel',
    });
    assert.deepEqual(result, { Cost: 70, AssessedCost: 300, currency: 'UAH', warnings: ['DateTime is set to current'] });
  });

  it('sends every optional argument, including cash on delivery', async () => {
    harness = await createHarness();
    harness.api.on('InternetDocument.getDocumentPrice', ok([fixtures.price]));

    const result = await harness.callJson('estimate_delivery_cost', {
      ...route,
      weight_kg: 2.5,
      service_type: 'WarehouseDoors',
      cargo_type: 'Cargo',
      declared_value: 1500,
      seats: 2,
      volume_m3: 0.02,
      cash_on_delivery: 1500,
    });

    assert.deepEqual(sent(harness).properties, {
      CitySender: REFS.kyivCity,
      CityRecipient: REFS.brovaryCity,
      Weight: 2.5,
      ServiceType: 'WarehouseDoors',
      CargoType: 'Cargo',
      Cost: 1500,
      SeatsAmount: 2,
      VolumeGeneral: 0.02,
      RedeliveryCalculate: { CargoType: 'Money', Amount: 1500 },
    });
    assert.deepEqual(result, { Cost: 122.5, CostRedelivery: 50, AssessedCost: 1500, currency: 'UAH' });
  });

  it('explains a city Nova Poshta does not know', async () => {
    harness = await createHarness();
    harness.api.on('InternetDocument.getDocumentPrice', failure(['CitySender not found'], ['20000200106']));

    const result = await harness.call('estimate_delivery_cost', { ...route, weight_kg: 1 });

    assert.equal(result.isError, true);
    assert.match(result.text, /^Nova Poshta API error: CitySender not found\ncity_sender_ref is not a city Nova Poshta knows/);
  });

  it('validates the arguments before anything is sent', async () => {
    harness = await createHarness();
    const invalid: Record<string, unknown>[] = [
      { ...route },
      { ...route, weight_kg: 0 },
      { ...route, weight_kg: 1, service_type: 'Express' },
      { ...route, weight_kg: 1, cargo_type: 'Money' },
      // Listed by Nova Poshta, but refused by its calculator without sizes that this tool does not take.
      { ...route, weight_kg: 1, cargo_type: 'Pallet' },
      { ...route, weight_kg: 1, cargo_type: 'TiresWheels' },
      { ...route, weight_kg: 1, seats: 1.5 },
      { ...route, weight_kg: 1, currency: 'USD' },
      { city_sender_ref: 'Київ', city_recipient_ref: REFS.brovaryCity, weight_kg: 1 },
    ];

    for (const args of invalid) {
      assert.equal((await harness.call('estimate_delivery_cost', args)).isError, true, JSON.stringify(args));
    }
    assert.equal(harness.api.requests.length, 0);
  });

  it('reports an answer without a price', async () => {
    harness = await createHarness();
    harness.api.on('InternetDocument.getDocumentPrice', ok([]));

    const result = await harness.call('estimate_delivery_cost', { ...route, weight_kg: 1 });

    assert.equal(result.isError, true);
    assert.match(result.text, /a price was expected/);
  });
});

describe('estimate_delivery_date', () => {
  const route = { city_sender_ref: REFS.kyivCity, city_recipient_ref: REFS.brovaryCity };

  it('returns the date in a plain form with its time zone', async () => {
    harness = await createHarness();
    harness.api.on('InternetDocument.getDocumentDeliveryDate', ok([fixtures.deliveryDate]));

    const result = await harness.callJson('estimate_delivery_date', { ...route, send_date: '2026-10-12', service_type: 'WarehousePostomat' });

    const { called, properties } = sent(harness);
    assert.equal(called, 'InternetDocument.getDocumentDeliveryDate');
    assert.deepEqual(properties, {
      CitySender: REFS.kyivCity,
      CityRecipient: REFS.brovaryCity,
      ServiceType: 'WarehousePostomat',
      // The API takes dates as dd.mm.yyyy and refuses the ISO form.
      DateTime: '12.10.2026',
    });
    assert.deepEqual(result, { delivery_date: '2026-10-13 11:30:00', timezone: 'Europe/Kiev' });
  });

  it('counts from now when no day is given and passes the remark of the API on', async () => {
    harness = await createHarness();
    harness.api.on('InternetDocument.getDocumentDeliveryDate', ok([fixtures.deliveryDate], { warnings: ['DateTime is set to current'] }));

    const result = await harness.callJson('estimate_delivery_date', route);

    assert.deepEqual(sent(harness).properties, { CitySender: REFS.kyivCity, CityRecipient: REFS.brovaryCity, ServiceType: 'WarehouseWarehouse' });
    assert.deepEqual(result.warnings, ['DateTime is set to current']);
  });

  it('rejects a day that does not exist or is written the Ukrainian way', async () => {
    harness = await createHarness();

    for (const send_date of ['2026-02-30', '12.10.2026']) {
      assert.equal((await harness.call('estimate_delivery_date', { ...route, send_date })).isError, true, send_date);
    }
    assert.equal(harness.api.requests.length, 0);
  });

  it('reports an answer without a date', async () => {
    harness = await createHarness();
    harness.api.on('InternetDocument.getDocumentDeliveryDate', ok([{ DeliveryDate: null }]));

    const result = await harness.call('estimate_delivery_date', route);

    assert.equal(result.isError, true);
    assert.match(result.text, /a delivery date was expected/);
  });
});
