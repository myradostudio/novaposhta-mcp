/**
 * The tools of the server. All of them are lookups or calculations: none
 * creates, changes or deletes anything at Nova Poshta.
 *
 * Input schemas are strict: an argument the tool does not know is rejected
 * instead of ignored, so the model never believes it applied a filter that was
 * silently dropped.
 *
 * Every property sent to the API here was sent to the live API on 2026-10-08
 * (see scripts/live-check.mjs); tests/support/contract.ts keeps that list.
 */

import { z } from 'zod';

import { ToolError } from '../errors.js';
import { METHODS } from '../methods.js';
import { cityRef, date, isObject, limit, objects, page, pagination, query, ref, resolvePage, toApiDate } from './schemas.js';
import {
  summarizeSettlement,
  summarizeStreet,
  summarizeTracking,
  summarizeWarehouse,
  summarizeWarehouseType,
} from './summaries.js';
import { defineTool, READ_ONLY, type AnyTool } from './types.js';

/** "Param Documents must not be more than 100 item" (answer of the live API). */
export const MAX_TRACKED_DOCUMENTS = 100;

/** `Ref` values returned by Common.getServiceTypes on 2026-10-08. */
export const SERVICE_TYPES = [
  'WarehouseWarehouse',
  'WarehouseDoors',
  'DoorsWarehouse',
  'DoorsDoors',
  'WarehousePostomat',
  'DoorsPostomat',
] as const;

/** `Ref` values returned by Common.getCargoTypes on 2026-10-08. */
export const CARGO_TYPES = ['Parcel', 'Cargo', 'Documents', 'TiresWheels', 'Pallet'] as const;

const serviceType = z
  .enum(SERVICE_TYPES)
  .optional()
  .describe(
    'How the parcel is handed over and received: Warehouse = branch, Doors = courier at an address, Postomat = parcel locker; the first word is the sender side. Default WarehouseWarehouse.',
  );

/** People paste numbers as "2045 0000 0000 00"; the API wants them without separators. */
const documentNumber = z
  .string()
  .min(6)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9\s-]*$/, 'Must be a waybill number: letters and digits, optionally separated by spaces or dashes.');

const phone = z.string().regex(/^\+?[\d\s()-]{10,20}$/, 'Must be a phone number, e.g. 380501234567.');

const withoutSeparators = (value: string) => value.replace(/[\s()+-]/g, '');

export const tools: readonly AnyTool[] = [
  defineTool({
    name: 'track_parcels',
    title: 'Track parcels',
    description:
      'Returns the current status of up to 100 Nova Poshta parcels by waybill number (ТТН, 14 digits): status text and code, route (cities and branches), dates of creation, planned and actual delivery, weight, delivery cost and who pays. A number Nova Poshta does not know comes back with found: false. Without a phone number the answer is the public one; with the phone of the sender or the recipient Nova Poshta adds names, phones and addresses, which is personal data. Empty and zero fields are left out; `all_fields: true` returns everything that carries a value.',
    inputSchema: z.strictObject({
      numbers: z
        .array(documentNumber)
        .min(1)
        .max(MAX_TRACKED_DOCUMENTS)
        .describe(`Waybill numbers, at most ${MAX_TRACKED_DOCUMENTS}. Spaces and dashes are removed.`),
      phone: phone
        .optional()
        .describe('Phone of the sender or the recipient, e.g. 380501234567. Applied to every number of the call; unlocks the full information for the parcels it belongs to.'),
      all_fields: z.boolean().optional().describe('true returns every non-empty field of the API instead of the compact selection.'),
    }),
    annotations: READ_ONLY,
    handler: async (args, { client }) => {
      const numbers = [...new Set(args.numbers.map(withoutSeparators))];
      const phoneDigits = args.phone === undefined ? '' : withoutSeparators(args.phone);
      const { data, warnings } = await client.call(METHODS.trackDocuments, {
        Documents: numbers.map((number) => ({ DocumentNumber: number, Phone: phoneDigits })),
      });
      const parcels = objects(data).map((document) => summarizeTracking(document, args.all_fields === true));
      // The reminder to pass a phone is repeated for every number; it is covered by the tool description.
      const remarks = warnings.filter((line) => !line.includes('Please enter a valid phone number'));
      return {
        data: {
          returned: parcels.length,
          parcels,
          ...(remarks.length > 0 ? { warnings: remarks } : {}),
        },
      };
    },
  }),

  defineTool({
    name: 'search_settlements',
    title: 'Search settlements',
    description:
      'Finds cities, towns and villages of Ukraine by the beginning of the name, written in Ukrainian. Each result has the full name with district and region (Present), the number of Nova Poshta branches and lockers there (Warehouses) and two identifiers: `Ref` identifies the settlement (use it as settlement_ref in search_warehouses and search_streets), `DeliveryCity` identifies the city for tariffs (use it as city_ref in search_warehouses and in the estimate tools). Several settlements can share a name, so check the region.',
    inputSchema: z.strictObject({
      name: query('Name of the settlement or its beginning, in Ukrainian letters, e.g. "Бровари".'),
      limit: limit(10, 50),
      page,
    }),
    annotations: READ_ONLY,
    handler: async (args, { client }) => {
      const requested = resolvePage(args, 10, 50);
      const { data } = await client.call(METHODS.searchSettlements, {
        CityName: args.name,
        Limit: requested.limit,
        Page: requested.page,
      });
      // The answer is one object: { TotalCount, Addresses: [...] }.
      const [result] = objects(data);
      const settlements = objects(result?.['Addresses']).map(summarizeSettlement);
      const total = typeof result?.['TotalCount'] === 'number' ? result['TotalCount'] : undefined;
      return { data: { pagination: pagination(requested, settlements.length, total), settlements } };
    },
  }),

  defineTool({
    name: 'search_warehouses',
    title: 'Search branches and parcel lockers',
    description:
      'Finds Nova Poshta branches (відділення) and parcel lockers (поштомати) in a city or settlement: number, description with the address, category, working hours (Schedule), weight limit per parcel in kg (PlaceMaxWeightAllowed), phone, coordinates and the identifiers Ref, CityRef and SettlementRef. Give the place as city_name, city_ref or settlement_ref, or ask for one branch by warehouse_ref. Narrow down by branch number, by text from the address, or by type (type_ref from list_warehouse_types, e.g. only parcel lockers). A big city has thousands of records: filter, or page through.',
    inputSchema: z.strictObject({
      city_name: query('Full name of the city in Ukrainian, e.g. "Київ". The beginning of a name finds nothing; use search_settlements for that.').optional(),
      city_ref: ref('City: `DeliveryCity` of a settlement from search_settlements, or `CityRef` of another branch.').optional(),
      settlement_ref: ref('Settlement: `Ref` of a settlement from search_settlements.').optional(),
      warehouse_ref: ref('One branch or locker by its `Ref`.').optional(),
      number: z.number().int().min(1).optional().describe('Number of the branch or locker, e.g. 2 for "Відділення №2".'),
      search: query('Text from the address or description of the branch, e.g. a street name.').optional(),
      type_ref: ref('Only this type of branch: `Ref` from list_warehouse_types.').optional(),
      limit: limit(20, 100),
      page,
    }),
    annotations: READ_ONLY,
    handler: async (args, { client }) => {
      if ([args.city_name, args.city_ref, args.settlement_ref, args.warehouse_ref].every((value) => value === undefined)) {
        throw new ToolError(
          'Say where to look: pass city_name, city_ref or settlement_ref (or warehouse_ref for one branch). Without a place the API would return all branches of the country.',
        );
      }
      const requested = resolvePage(args, 20, 100);
      const { data, totalCount } = await client.call(METHODS.warehouses, {
        CityName: args.city_name,
        CityRef: args.city_ref,
        SettlementRef: args.settlement_ref,
        Ref: args.warehouse_ref,
        WarehouseId: args.number === undefined ? undefined : String(args.number),
        FindByString: args.search,
        TypeOfWarehouseRef: args.type_ref,
        Limit: requested.limit,
        Page: requested.page,
      });
      const warehouses = objects(data).map(summarizeWarehouse);
      return { data: { pagination: pagination(requested, warehouses.length, totalCount), warehouses } };
    },
  }),

  defineTool({
    name: 'list_warehouse_types',
    title: 'List types of branches',
    description:
      'Lists the types of Nova Poshta service points with their identifiers: post branch, cargo branch, parcel locker and others. Use a `Ref` as type_ref in search_warehouses to get, for example, only parcel lockers.',
    inputSchema: z.strictObject({}),
    annotations: READ_ONLY,
    handler: async (_args, { client }) => {
      const { data } = await client.call(METHODS.warehouseTypes);
      return { data: { types: objects(data).map(summarizeWarehouseType) } };
    },
  }),

  defineTool({
    name: 'search_streets',
    title: 'Search streets of a settlement',
    description:
      'Finds streets of one settlement by the beginning of a word of the name, in Ukrainian: the name with its type (Present, e.g. "вул. Київська") and the identifier of the street. Needed for courier delivery to an address. Check StreetsAvailability of the settlement in search_settlements first: small settlements have no street directory.',
    inputSchema: z.strictObject({
      settlement_ref: ref('Settlement: `Ref` of a settlement from search_settlements.'),
      name: query('A word of the street name or its beginning, in Ukrainian letters, without "вул.".'),
      limit: limit(10, 50),
    }),
    annotations: READ_ONLY,
    handler: async (args, { client }) => {
      const requested = resolvePage(args, 10, 50);
      const { data } = await client.call(METHODS.searchStreets, {
        StreetName: args.name,
        SettlementRef: args.settlement_ref,
        Limit: requested.limit,
      });
      const [result] = objects(data);
      const streets = objects(result?.['Addresses']).map(summarizeStreet);
      const total = typeof result?.['TotalCount'] === 'number' ? result['TotalCount'] : streets.length;
      return { data: { total, returned: streets.length, streets } };
    },
  }),

  defineTool({
    name: 'estimate_delivery_cost',
    title: 'Estimate the delivery cost',
    description:
      'Calculates what Nova Poshta charges for a delivery between two cities, in hryvnias: Cost is the delivery itself, AssessedCost the declared value used, CostRedelivery the fee for cash on delivery when cash_on_delivery is given. This is a calculation, no waybill is created. The figure is what the calculator of Nova Poshta returns for this request; do not present it as the price of a particular contract. Nova Poshta may adjust the cargo type or the date and says so in `warnings`.',
    inputSchema: z.strictObject({
      city_sender_ref: cityRef('sender'),
      city_recipient_ref: cityRef('recipient'),
      weight_kg: z.number().min(0.1).max(10_000).describe('Actual weight in kilograms, e.g. 2.5.'),
      service_type: serviceType,
      cargo_type: z.enum(CARGO_TYPES).optional().describe('Kind of cargo. Default Parcel.'),
      declared_value: z.number().min(1).optional().describe('Declared value of the contents in hryvnias. Nova Poshta uses its own minimum when omitted.'),
      seats: z.number().int().min(1).max(100).optional().describe('Number of pieces. Default 1.'),
      volume_m3: z.number().min(0.0001).max(100).optional().describe('Total volume in cubic metres, for bulky cargo.'),
      cash_on_delivery: z
        .number()
        .min(1)
        .optional()
        .describe('Amount in hryvnias the recipient pays for the goods on receipt (післяплата). Adds CostRedelivery to the result.'),
    }),
    annotations: READ_ONLY,
    handler: async (args, { client }) => {
      const { data, warnings } = await client.call(METHODS.deliveryPrice, {
        CitySender: args.city_sender_ref,
        CityRecipient: args.city_recipient_ref,
        Weight: args.weight_kg,
        ServiceType: args.service_type ?? 'WarehouseWarehouse',
        CargoType: args.cargo_type ?? 'Parcel',
        Cost: args.declared_value,
        SeatsAmount: args.seats,
        VolumeGeneral: args.volume_m3,
        RedeliveryCalculate:
          args.cash_on_delivery === undefined ? undefined : { CargoType: 'Money', Amount: args.cash_on_delivery },
      });
      const [price] = objects(data);
      if (price === undefined) throw new ToolError('Unexpected response from the Nova Poshta API: a price was expected.');
      return { data: { ...price, currency: 'UAH', ...(warnings.length > 0 ? { warnings } : {}) } };
    },
  }),

  defineTool({
    name: 'estimate_delivery_date',
    title: 'Estimate the delivery date',
    description:
      'Estimates when a parcel sent between two cities arrives: the date and time in the Europe/Kyiv time zone. Without send_date Nova Poshta counts from now and says so in `warnings`. This is an estimate of the carrier, not a promise, and no waybill is created.',
    inputSchema: z.strictObject({
      city_sender_ref: cityRef('sender'),
      city_recipient_ref: cityRef('recipient'),
      service_type: serviceType,
      send_date: date('Day the parcel is handed over.').optional(),
    }),
    annotations: READ_ONLY,
    handler: async (args, { client }) => {
      const { data, warnings } = await client.call(METHODS.deliveryDate, {
        CitySender: args.city_sender_ref,
        CityRecipient: args.city_recipient_ref,
        ServiceType: args.service_type ?? 'WarehouseWarehouse',
        DateTime: args.send_date === undefined ? undefined : toApiDate(args.send_date),
      });
      const [result] = objects(data);
      const delivery = result?.['DeliveryDate'];
      if (!isObject(delivery) || typeof delivery['date'] !== 'string') {
        throw new ToolError('Unexpected response from the Nova Poshta API: a delivery date was expected.');
      }
      return {
        data: {
          // "2026-10-13 11:30:00.000000" → "2026-10-13 11:30:00"
          delivery_date: delivery['date'].replace(/\.\d+$/, ''),
          timezone: typeof delivery['timezone'] === 'string' ? delivery['timezone'] : null,
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    },
  }),
];
