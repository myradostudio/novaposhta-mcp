/**
 * Catalogue of the Nova Poshta API methods this server calls.
 *
 * The API is a single address, `POST /v2.0/json/`, that takes
 * `{ apiKey, modelName, calledMethod, methodProperties }`. There is no HTTP verb
 * to tell a read from a write, so the read-only promise of the server rests on
 * this list: it holds lookups and calculations only, and the client refuses to
 * call anything that is not in it. None of these methods creates, changes or
 * deletes a waybill, a counterparty or anything else.
 */

export const API_PATH = '/v2.0/json/';

export interface ApiMethod {
  readonly model: string;
  readonly method: string;
}

function method(model: string, name: string): ApiMethod {
  // Frozen: an entry that passed the catalogue check cannot be turned into another method afterwards.
  return Object.freeze({ model, method: name });
}

export const METHODS = {
  // Tracking
  trackDocuments: method('TrackingDocument', 'getStatusDocuments'),

  // Address directories
  searchSettlements: method('Address', 'searchSettlements'),
  searchStreets: method('Address', 'searchSettlementStreets'),
  warehouses: method('AddressGeneral', 'getWarehouses'),
  warehouseTypes: method('AddressGeneral', 'getWarehouseTypes'),

  // Calculations (nothing is stored)
  deliveryPrice: method('InternetDocument', 'getDocumentPrice'),
  deliveryDate: method('InternetDocument', 'getDocumentDeliveryDate'),
} as const satisfies Record<string, ApiMethod>;

export type MethodName = keyof typeof METHODS;

const ALLOWED = new Set<ApiMethod>(Object.values(METHODS));

/** True only for the very objects of the catalogue: a look-alike built elsewhere does not pass. */
export function isCatalogued(candidate: ApiMethod): boolean {
  return ALLOWED.has(candidate);
}
