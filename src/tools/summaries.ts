/**
 * Compact projections of Nova Poshta objects.
 *
 * The API answers with every field it has, most of them empty: a tracking record
 * has more than a hundred, a branch about sixty. Tools return these projections
 * to keep the model's context small. Field names are the API's own, taken from
 * answers of the live API on 2026-10-08; Russian duplicates of names
 * (`DescriptionRu` and the like) are left out.
 *
 * Every function tolerates missing fields, so an API change degrades to a
 * sparser result instead of an error.
 */

import { isObject } from './schemas.js';

type Json = Record<string, unknown>;

/** The API marks "no value" in several ways, depending on the field: "", " ", 0, "0", false, [] or null. */
function isEmpty(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '' || value === '0';
  return value === undefined || value === null || value === 0 || value === false || (Array.isArray(value) && value.length === 0);
}

/** Copies the listed keys that carry a value. */
function pick(source: unknown, keys: readonly string[]): Json {
  const result: Json = {};
  if (!isObject(source)) return result;
  for (const key of keys) {
    const value = source[key];
    if (!isEmpty(value)) result[key] = value;
  }
  return result;
}

/** Documented by the API itself in the `Status` text; the code for "not found" was confirmed on the live API. */
const STATUS_NOT_FOUND = '3';

const TRACKING_FIELDS = [
  'Number',
  'StatusCode',
  'Status',
  'DateCreated',
  'ScheduledDeliveryDate',
  'ActualDeliveryDate',
  'RecipientDateTime',
  'TrackingUpdateDate',
  'DateFirstDayStorage',
  'DatePayedKeeping',
  'DaysStorageCargo',
  'StoragePrice',
  'StorageAmount',
  'CitySender',
  'WarehouseSender',
  'CityRecipient',
  'WarehouseRecipient',
  'WarehouseRecipientNumber',
  'CategoryOfWarehouse',
  'RecipientAddress',
  'ServiceType',
  'CargoType',
  'CargoDescriptionString',
  'SeatsAmount',
  'DocumentWeight',
  'FactualWeight',
  'VolumeWeight',
  'DocumentCost',
  'AnnouncedPrice',
  'PayerType',
  'PaymentMethod',
  'PaymentStatus',
  'AmountToPay',
  'AmountPaid',
  'AfterpaymentOnGoodsCost',
  'RedeliverySum',
  'RedeliveryNum',
  'UndeliveryReasonsSubtypeDescription',
  'UndeliveryReasonsDate',
  'LastCreatedOnTheBasisDocumentType',
  'LastCreatedOnTheBasisNumber',
  // Filled in only when the phone number of the sender or the recipient was passed.
  'SenderFullNameEW',
  'CounterpartySenderDescription',
  'PhoneSender',
  'SenderAddress',
  'RecipientFullName',
  'RecipientFullNameEW',
  'CounterpartyRecipientDescription',
  'PhoneRecipient',
] as const;

export function summarizeTracking(document: Json, full: boolean): Json {
  const found = document['StatusCode'] !== STATUS_NOT_FOUND;
  if (full) {
    // Every field that carries a value, as the API named it.
    return { found, ...pick(document, Object.keys(document)) };
  }
  return { found, ...pick(document, TRACKING_FIELDS) };
}

export function summarizeSettlement(settlement: Json): Json {
  return {
    ...pick(settlement, ['Present', 'MainDescription', 'Area', 'Region', 'SettlementTypeCode', 'Ref', 'DeliveryCity', 'Warehouses']),
    // Kept even when false: "no address delivery" is an answer, not an absent value.
    ...(typeof settlement['AddressDeliveryAllowed'] === 'boolean' ? { AddressDeliveryAllowed: settlement['AddressDeliveryAllowed'] } : {}),
    ...(typeof settlement['StreetsAvailability'] === 'boolean' ? { StreetsAvailability: settlement['StreetsAvailability'] } : {}),
  };
}

export function summarizeWarehouse(warehouse: Json): Json {
  return pick(warehouse, [
    'Ref',
    'Number',
    'Description',
    'ShortAddress',
    'CategoryOfWarehouse',
    'TypeOfWarehouse',
    'WarehouseStatus',
    'CityRef',
    'CityDescription',
    'SettlementRef',
    'SettlementDescription',
    'SettlementAreaDescription',
    'Phone',
    'PostalCodeUA',
    'PlaceMaxWeightAllowed',
    'TotalMaxWeightAllowed',
    'Latitude',
    'Longitude',
    'Schedule',
  ]);
}

export function summarizeWarehouseType(type: Json): Json {
  return pick(type, ['Ref', 'Description']);
}

export function summarizeStreet(street: Json): Json {
  return pick(street, ['Present', 'SettlementStreetDescription', 'StreetsTypeDescription', 'SettlementStreetRef', 'SettlementRef']);
}
