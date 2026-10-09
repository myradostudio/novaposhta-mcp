/**
 * A stand-in for the Nova Poshta API that is consistent enough for the live
 * check to pass: a few settlements, the service points and streets of one town,
 * a price list and one parcel. Unlike the canned answers of the other tests it
 * applies the filters it is sent, because that is what the live check verifies.
 *
 * Every name, number and phone here is made up, as in fixtures.ts.
 */

import { FakeApi, failure, ok, type RecordedRequest } from './fake-api.js';
import * as fixtures from './fixtures.js';
import { NUMBERS, REFS } from './fixtures.js';

/** The phone of the recipient of the one parcel the stand-in knows. */
export const PARTICIPANT_PHONE = fixtures.deliveredParcelWithPeople.PhoneRecipient;

const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const [brovary] = fixtures.settlements.Addresses;
const KYIV_SETTLEMENT = guid(1);

interface Settlement extends Record<string, unknown> {
  readonly MainDescription: string;
  /** A name the settlement had before; the API finds it by that one too. */
  readonly former?: string;
}

const settlement = (name: string, area: string, extra: Record<string, unknown> = {}): Settlement => ({
  ...brovary,
  Present: `с. ${name}, ${area} обл.`,
  MainDescription: name,
  Area: area,
  Region: '',
  SettlementTypeCode: 'с.',
  Ref: guid(100 + SETTLEMENTS.length),
  DeliveryCity: guid(500 + SETTLEMENTS.length),
  Warehouses: 1,
  ...extra,
});

const SETTLEMENTS: Settlement[] = [];
SETTLEMENTS.push({ ...brovary, MainDescription: 'Бровари' });
SETTLEMENTS.push(settlement('Бровари', 'Львівська'));
SETTLEMENTS.push(settlement('Київ', 'Київська', { Present: 'м. Київ, Київська обл.', SettlementTypeCode: 'м.', Ref: KYIV_SETTLEMENT, DeliveryCity: REFS.kyivCity }));
// Found by a former name, as Zviahel is by "Новоград-Волинський" on the live API.
for (let n = 1; n <= 5; n += 1) SETTLEMENTS.push({ ...settlement(`Звягель ${n}`, 'Житомирська'), former: 'Новоград' });
for (let n = 1; n <= 55; n += 1) SETTLEMENTS.push(settlement(`Новосілки ${n}`, 'Київська'));

const WAREHOUSES: Record<string, unknown>[] = [];
for (let n = 1; n <= 130; n += 1) {
  const locker = n > 90;
  const street = locker || n % 2 === 0 ? 'Київська' : 'Незалежності';
  WAREHOUSES.push({
    ...fixtures.warehouse,
    Ref: n === 2 ? REFS.branch : guid(1000 + n),
    Number: String(n),
    Description: `${locker ? 'Поштомат' : 'Відділення'} №${n}: вул. ${street}, ${n}`,
    ShortAddress: `Бровари, ${street}, ${n}`,
    TypeOfWarehouse: locker ? REFS.lockerType : REFS.branchType,
    CategoryOfWarehouse: locker ? 'Postomat' : 'Branch',
  });
}
// A branch №2 in another city, so that a place filter that is not applied shows.
WAREHOUSES.push({
  ...fixtures.warehouse,
  Ref: guid(3000),
  Description: 'Відділення №2: вул. Хрещатик, 22',
  ShortAddress: 'Київ, Хрещатик, 22',
  CityRef: REFS.kyivCity,
  CityDescription: 'Київ',
  SettlementRef: KYIV_SETTLEMENT,
  SettlementDescription: 'Київ',
});

const STREETS = ['Київська', 'Київської Русі', 'Кирпоноса', 'Незалежності'].map((name, index) => ({
  ...fixtures.streets.Addresses[0],
  SettlementStreetRef: index === 0 ? REFS.street : guid(2000 + index),
  SettlementStreetDescription: name,
  Present: `вул. ${name}`,
}));

const BASE_COST: Readonly<Record<string, number>> = {
  WarehouseWarehouse: 70,
  WarehouseDoors: 130,
  DoorsWarehouse: 130,
  DoorsDoors: 190,
  WarehousePostomat: 80,
  DoorsPostomat: 140,
};

const paged = <T>(items: readonly T[], limit: number, page: number) => items.slice((page - 1) * limit, page * limit);

type Answer = (request: RecordedRequest) => Response;

/** The answers by `Model.method`. A test replaces one of them to see the check fail. */
export const answers: Readonly<Record<string, Answer>> = {
  'Address.searchSettlements': ({ properties }) => {
    const text = String(properties['CityName']).toLowerCase();
    if (/[a-z]/.test(text)) return failure(['CityName has invalid characters'], ['20000500652']);
    const found = SETTLEMENTS.filter(
      (item) => item.MainDescription.toLowerCase().startsWith(text) || item.former?.toLowerCase().startsWith(text) === true,
    );
    const addresses = paged(found, properties['Limit'] ?? 150, properties['Page'] ?? 1).map(({ former: _former, ...rest }) => rest);
    return ok([{ TotalCount: found.length, Addresses: addresses }]);
  },

  'AddressGeneral.getWarehouseTypes': () => ok(fixtures.warehouseTypes),

  'AddressGeneral.getWarehouses': ({ properties }) => {
    const is = (property: string, field: string) => properties[property] === undefined || ((item: Record<string, unknown>) => item[field] === properties[property]);
    const filters = [
      is('CityName', 'CityDescription'),
      is('CityRef', 'CityRef'),
      is('SettlementRef', 'SettlementRef'),
      is('Ref', 'Ref'),
      is('WarehouseId', 'Number'),
      is('TypeOfWarehouseRef', 'TypeOfWarehouse'),
      properties['FindByString'] === undefined ||
        ((item: Record<string, unknown>) => `${item['Description']} ${item['ShortAddress']}`.includes(properties['FindByString'])),
    ];
    const found = WAREHOUSES.filter((item) => filters.every((filter) => filter === true || filter(item)));
    return ok(paged(found, properties['Limit'] ?? 500, properties['Page'] ?? 1), { info: { totalCount: found.length } });
  },

  'Address.searchSettlementStreets': ({ properties }) => {
    const text = String(properties['StreetName']).toLowerCase();
    const found =
      properties['SettlementRef'] === REFS.brovarySettlement
        ? STREETS.filter((street) => street.SettlementStreetDescription.toLowerCase().startsWith(text))
        : [];
    return ok([{ TotalCount: found.length, Addresses: found.slice(0, properties['Limit'] ?? 50) }]);
  },

  'InternetDocument.getDocumentPrice': ({ properties }) => {
    const perSeat = (BASE_COST[properties['ServiceType']] ?? 70) + Math.max(0, properties['Weight'] - 2) * 5;
    const redelivery = properties['RedeliveryCalculate'];
    return ok(
      [
        {
          Cost: perSeat * (properties['SeatsAmount'] ?? 1),
          AssessedCost: properties['Cost'] ?? 300,
          CostRedelivery: redelivery === undefined ? 0 : 20 + redelivery.Amount * 0.02,
        },
      ],
      { warnings: ['DateTime is set to current'] },
    );
  },

  'InternetDocument.getDocumentDeliveryDate': ({ properties }) => {
    const asked: string | undefined = properties['DateTime'];
    // The API takes the day as dd.mm.yyyy.
    const sent = asked === undefined ? new Date() : new Date(`${asked.slice(6)}-${asked.slice(3, 5)}-${asked.slice(0, 2)}T00:00:00Z`);
    const arrives = new Date(sent.getTime() + 86_400_000).toISOString().slice(0, 10);
    return ok(
      [{ DeliveryDate: { date: `${arrives} 11:30:00.000000`, timezone_type: 3, timezone: 'Europe/Kiev' } }],
      asked === undefined ? { warnings: ['DateTime is set to current'] } : {},
    );
  },

  'TrackingDocument.getStatusDocuments': ({ properties }) => {
    const documents: { DocumentNumber: string; Phone: string }[] = properties['Documents'];
    if (documents.some((document) => !/^\d{14}$/.test(document.DocumentNumber))) {
      return failure(['Document number is not correct'], ['20001401442']);
    }
    const warnings: Record<string, string>[] = [];
    const data = documents.map((document) => {
      if (document.DocumentNumber !== NUMBERS.delivered) return { ...fixtures.unknownParcel, Number: document.DocumentNumber };
      if (document.Phone === PARTICIPANT_PHONE) return fixtures.deliveredParcelWithPeople;
      // The remark the API adds when no phone was passed, or one that does not belong to the waybill.
      warnings.push(fixtures.phoneReminder(document.DocumentNumber));
      return fixtures.deliveredParcel;
    });
    return ok(data, { warnings });
  },
};

export function liveWorld(): FakeApi {
  const api = new FakeApi();
  for (const [called, answer] of Object.entries(answers)) api.on(called, answer);
  return api;
}
