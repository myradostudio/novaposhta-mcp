/**
 * Checks recorded requests against what was confirmed on the live API.
 *
 * Nova Poshta publishes no machine-readable description of its API, so there is
 * no document to take a snapshot of. Instead this file lists, for every method
 * the server calls, the properties that `scripts/live-check.mjs` sent to the real
 * API on 2026-10-08 and that the API accepted. A request that carries any other
 * property, or a value of another type, fails the test: nothing may be sent that
 * was not tried for real.
 */

import assert from 'node:assert/strict';

import { API_PATH, METHODS } from '../../src/methods.js';
import type { RecordedRequest } from './fake-api.js';

/**
 * Written out here, not imported from the tools: these are the values scripts/live-check.mjs sent and the API
 * accepted. tests/server.test.ts fails when a tool offers a value that is not in these lists.
 */
export const SERVICE_TYPES_SENT = ['WarehouseWarehouse', 'WarehouseDoors', 'DoorsWarehouse', 'DoorsDoors', 'WarehousePostomat', 'DoorsPostomat'];
export const CARGO_TYPES_SENT = ['Parcel', 'Cargo', 'Documents'];
/** The largest page each directory was asked for in the live check. */
export const MAX_LIMIT_SENT = { settlements: 50, streets: 50, warehouses: 100 } as const;

type Check = (value: unknown) => boolean;

const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text: Check = (value) => typeof value === 'string' && value.length > 0;
const ref: Check = (value) => typeof value === 'string' && REF.test(value);
const positiveInteger: Check = (value) => typeof value === 'number' && Number.isInteger(value) && value > 0;
const upTo =
  (max: number): Check =>
  (value) =>
    positiveInteger(value) && (value as number) <= max;
const positiveNumber: Check = (value) => typeof value === 'number' && value > 0;
const oneOf =
  (values: readonly string[]): Check =>
  (value) =>
    typeof value === 'string' && values.includes(value);
const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();

export const LIVE_CHECKED: Readonly<Record<string, Readonly<Record<string, Check>>>> = {
  'TrackingDocument.getStatusDocuments': {
    Documents: (value) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (item) =>
          exactKeys(item, ['DocumentNumber', 'Phone']) &&
          typeof item['DocumentNumber'] === 'string' &&
          /^[A-Za-z0-9]+$/.test(item['DocumentNumber']) &&
          typeof item['Phone'] === 'string' &&
          /^\d*$/.test(item['Phone']),
      ),
  },
  'Address.searchSettlements': { CityName: text, Limit: upTo(MAX_LIMIT_SENT.settlements), Page: positiveInteger },
  'Address.searchSettlementStreets': { StreetName: text, SettlementRef: ref, Limit: upTo(MAX_LIMIT_SENT.streets) },
  'AddressGeneral.getWarehouses': {
    CityName: text,
    CityRef: ref,
    SettlementRef: ref,
    Ref: ref,
    WarehouseId: (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value),
    FindByString: text,
    TypeOfWarehouseRef: ref,
    Limit: upTo(MAX_LIMIT_SENT.warehouses),
    Page: positiveInteger,
  },
  'AddressGeneral.getWarehouseTypes': {},
  'InternetDocument.getDocumentPrice': {
    CitySender: ref,
    CityRecipient: ref,
    Weight: positiveNumber,
    ServiceType: oneOf(SERVICE_TYPES_SENT),
    CargoType: oneOf(CARGO_TYPES_SENT),
    Cost: positiveNumber,
    SeatsAmount: positiveInteger,
    VolumeGeneral: positiveNumber,
    RedeliveryCalculate: (value) => exactKeys(value, ['CargoType', 'Amount']) && value['CargoType'] === 'Money' && positiveNumber(value['Amount']),
  },
  'InternetDocument.getDocumentDeliveryDate': {
    CitySender: ref,
    CityRecipient: ref,
    ServiceType: oneOf(SERVICE_TYPES_SENT),
    DateTime: (value) => typeof value === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(value),
  },
};

const CATALOGUE = new Set(Object.values(METHODS).map((method) => `${method.model}.${method.method}`));

/**
 * Asserts that a request the server sent is one the live check covered: the one
 * address of the API, the four fields of the envelope, a method of the read-only
 * catalogue, and only properties that were tried on the real API, with values of
 * the same kind. Returns `Model.method`.
 */
export function assertMatchesContract(request: RecordedRequest, expectedKey = ''): string {
  const errors: string[] = [];

  if (request.method !== 'POST') errors.push(`method: ${request.method}, the API takes POST only`);
  if (request.url.pathname !== API_PATH) errors.push(`path: ${request.url.pathname}, expected ${API_PATH}`);
  if (request.url.search !== '') errors.push('query string: nothing may be sent in the URL');
  if (request.headers['content-type'] !== 'application/json') errors.push('header Content-Type: must be application/json');
  if (request.redirect !== 'manual') errors.push('redirects must not be followed');

  if (Object.keys(request.body).sort().join() !== 'apiKey,calledMethod,methodProperties,modelName') {
    errors.push(`body: unexpected fields ${Object.keys(request.body).join(', ')}`);
  }
  if (request.body['apiKey'] !== expectedKey) errors.push('body.apiKey: not the configured key');

  if (!CATALOGUE.has(request.called)) {
    errors.push(`${request.called} is not in the catalogue of read-only methods`);
  }
  const allowed = LIVE_CHECKED[request.called];
  if (allowed === undefined) {
    errors.push(`${request.called} was not covered by the live check`);
  } else {
    for (const [name, value] of Object.entries(request.properties)) {
      const check = allowed[name];
      if (check === undefined) errors.push(`methodProperties.${name}: was not sent in the live check`);
      else if (!check(value)) errors.push(`methodProperties.${name}: ${JSON.stringify(value)} is not the kind of value the live check sent`);
    }
  }

  assert.deepEqual(errors, [], `${request.called} with ${JSON.stringify(request.properties)} is outside the checked contract`);
  return request.called;
}
