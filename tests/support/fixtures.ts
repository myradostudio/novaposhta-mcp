/**
 * Response fixtures in the shape the live API answered with on 2026-10-08.
 *
 * Directory records (a settlement, a branch, a street, the types) are shortened
 * copies of public directory data. Tracking records keep the field names and
 * value formats of real answers, but every number, name, phone and address in
 * them is made up.
 */

export const REFS = {
  kyivCity: '8d5a980d-391c-11dd-90d9-001a92567626',
  brovaryCity: 'db5c88d7-391c-11dd-90d9-001a92567626',
  brovarySettlement: 'e715719e-4b33-11e4-ab6d-005056801329',
  branch: '47402eb3-e1c2-11e3-8c4a-0050568002cf',
  branchType: '841339c7-591a-42e2-8233-7a0a00f0ed6f',
  lockerType: 'f9316480-5f2d-425d-bc2c-ac7cd29decf0',
  street: '0f9592cd-6848-11e6-8304-00505688561d',
} as const;

export const settlements = {
  TotalCount: 3,
  Addresses: [
    {
      Present: 'м. Бровари, Броварський р-н, Київська обл.',
      Warehouses: 610,
      MainDescription: 'Бровари',
      Area: 'Київська',
      Region: 'Броварський',
      SettlementTypeCode: 'м.',
      Ref: REFS.brovarySettlement,
      DeliveryCity: REFS.brovaryCity,
      AddressDeliveryAllowed: true,
      StreetsAvailability: true,
      ParentRegionTypes: 'область',
      ParentRegionCode: 'обл.',
      RegionTypes: 'район',
      RegionTypesCode: 'р-н',
    },
    {
      Present: 'с. Броварі, Бучацький р-н, Тернопільська обл.',
      Warehouses: 0,
      MainDescription: 'Броварі',
      Area: 'Тернопільська',
      Region: 'Бучацький',
      SettlementTypeCode: 'с.',
      Ref: '0eb7e688-4b3a-11e4-ab6d-005056801329',
      DeliveryCity: '06f878fe-4079-11de-b509-001d92f78698',
      AddressDeliveryAllowed: true,
      StreetsAvailability: false,
      ParentRegionTypes: 'область',
      ParentRegionCode: 'обл.',
      RegionTypes: 'район',
      RegionTypesCode: 'р-н',
    },
  ],
};

export const warehouse = {
  SiteKey: '228',
  Description: 'Відділення №2 (до 30 кг на одне місце): вул. Київська, 302',
  DescriptionRu: 'Отделение №2 (до 30 кг на одно место): ул. Киевская, 302',
  ShortAddress: 'Бровари, Київська, 302',
  ShortAddressRu: 'Бровары, Киевская, 302',
  Phone: '380800500609',
  TypeOfWarehouse: REFS.branchType,
  Ref: REFS.branch,
  Number: '2',
  CityRef: REFS.brovaryCity,
  CityDescription: 'Бровари',
  CityDescriptionRu: 'Бровары',
  SettlementRef: REFS.brovarySettlement,
  SettlementDescription: 'Бровари',
  SettlementAreaDescription: 'Київська',
  SettlementRegionsDescription: 'Броварський',
  SettlementTypeDescription: 'місто',
  SettlementTypeDescriptionRu: 'город',
  Longitude: '30.787476000000000',
  Latitude: '50.518295000000000',
  PostFinance: '0',
  BicycleParking: '0',
  PaymentAccess: '1',
  POSTerminal: '1',
  InternationalShipping: '1',
  SelfServiceWorkplacesCount: '1',
  TotalMaxWeightAllowed: '0',
  PlaceMaxWeightAllowed: '30',
  SendingLimitationsOnDimensions: { Width: 70, Height: 70, Length: 120 },
  ReceivingLimitationsOnDimensions: { Width: 70, Height: 70, Length: 120 },
  Reception: { Monday: '08:00-20:00', Sunday: '09:00-19:00' },
  Delivery: { Monday: '08:00-20:00', Sunday: '09:00-19:00' },
  Schedule: {
    Monday: '08:00-21:00',
    Tuesday: '08:00-21:00',
    Wednesday: '08:00-21:00',
    Thursday: '08:00-21:00',
    Friday: '08:00-21:00',
    Saturday: '08:00-19:00',
    Sunday: '08:00-19:00',
  },
  DistrictCode: 'БрвВ19/В2',
  WarehouseStatus: 'Working',
  WarehouseStatusDate: '2022-03-20 00:00:00',
  CategoryOfWarehouse: 'Branch',
  Direct: '',
  RegionCity: 'КИЇВ СХІД ПОСИЛКОВИЙ',
  MaxDeclaredCost: '0',
  DenyToSelect: '0',
  PostMachineType: '',
  PostalCodeUA: '07401',
  WarehouseIndex: '14/2',
  BeaconCode: '',
  Location: '',
};

export const warehouseTypes = [
  { Ref: '6f8c7162-4b72-4b0a-88e5-906948c6a92f', Description: 'Поштове відділення з обмеження', DescriptionRu: 'Parcel Shop' },
  { Ref: REFS.branchType, Description: 'Поштове(ий)', DescriptionRu: 'Почтовое отделение' },
  { Ref: '95dc212d-479c-4ffb-a8ab-8c1b9073d0bc', Description: 'Поштомат ПриватБанку', DescriptionRu: 'Почтомат приват банка' },
  { Ref: '9a68df70-0267-42a8-bb5c-37f427e36ee4', Description: 'Вантажне(ий)', DescriptionRu: 'Грузовое отделение' },
  { Ref: REFS.lockerType, Description: 'Поштомат', DescriptionRu: 'Почтомат' },
];

export const streets = {
  TotalCount: 1,
  Addresses: [
    {
      SettlementRef: REFS.brovarySettlement,
      SettlementStreetRef: REFS.street,
      SettlementStreetDescription: 'Київська',
      Present: 'вул. Київська',
      StreetsType: '0f1d7fbb-4bba-11e4-ab6d-005056801329',
      StreetsTypeDescription: 'вул.',
      Location: { lat: 50.50494398921728, lon: 30.77612891793251 },
      SettlementStreetDescriptionRu: 'Киевская',
    },
  ],
};

/** The many fields the API sends empty for every tracking record, here for a number it does not know. */
const emptyTracking = {
  StatusCode: '3',
  DateCreated: '',
  Status: 'Номер не знайдено',
  RefEW: '',
  RecipientDateTime: '',
  CargoType: '',
  CargoDescriptionString: '',
  DocumentCost: '',
  AnnouncedPrice: 0,
  DocumentWeight: 0,
  CheckWeight: 0,
  FactualWeight: '',
  VolumeWeight: '',
  SeatsAmount: '',
  ServiceType: '',
  CitySender: '',
  CounterpartySenderDescription: '',
  CounterpartySenderType: '',
  PhoneSender: '',
  SenderAddress: '',
  SenderFullNameEW: '',
  WarehouseSender: '',
  CityRecipient: '',
  CounterpartyRecipientDescription: '',
  PhoneRecipient: '',
  RecipientAddress: '',
  RecipientFullName: '',
  RecipientFullNameEW: ' ',
  WarehouseRecipient: '',
  WarehouseRecipientNumber: '',
  CategoryOfWarehouse: '',
  PayerType: '',
  PaymentMethod: '',
  PaymentStatus: '',
  AmountPaid: 0,
  AmountToPay: 0,
  AfterpaymentOnGoodsCost: 0,
  Redelivery: 0,
  RedeliveryNum: '',
  RedeliverySum: '',
  ScheduledDeliveryDate: '',
  ActualDeliveryDate: '',
  TrackingUpdateDate: '',
  DateFirstDayStorage: '',
  DatePayedKeeping: '',
  DaysStorageCargo: '',
  StorageAmount: '',
  StoragePrice: '',
  UndeliveryReasonsSubtypeDescription: '',
  UndeliveryReasonsDate: '',
  LastCreatedOnTheBasisDocumentType: '',
  LastCreatedOnTheBasisNumber: '',
  AviaDelivery: 0,
  CargoReturnRefusal: false,
  Packaging: [],
  PossibilityCreateReturn: false,
  FinalEUReturnDate: null,
  Edit: true,
};

export const NUMBERS = { unknown: '20400000000000', delivered: '20450000000001' } as const;

export const unknownParcel = { Number: NUMBERS.unknown, ...emptyTracking };

/** A delivered parcel as public tracking shows it: no names, phones or addresses of people. */
export const deliveredParcel = {
  ...emptyTracking,
  Number: NUMBERS.delivered,
  StatusCode: '9',
  Status: 'Відправлення отримано',
  DateCreated: '01-10-2026 19:18:12',
  RecipientDateTime: '04.10.2026 08:10:48',
  CargoType: 'Parcel',
  DocumentCost: '135',
  DocumentWeight: 5.47,
  CheckWeight: 6.52,
  FactualWeight: '2.10',
  VolumeWeight: '5.47',
  SeatsAmount: '1',
  ServiceType: 'WarehouseWarehouse',
  CitySender: 'Житомир',
  CounterpartySenderType: 'PrivatePerson',
  WarehouseSender: 'Відділення №1: вул. Прикладна, 1',
  CityRecipient: 'Бровари',
  WarehouseRecipient: 'Відділення №2 (до 30 кг на одне місце): вул. Київська, 302',
  WarehouseRecipientNumber: 2,
  CategoryOfWarehouse: 'Branch',
  PayerType: 'Recipient',
  PaymentMethod: 'Cash',
  PaymentStatus: 'PAYED',
  AmountPaid: '135',
  ScheduledDeliveryDate: '02-10-2026 08:02:03',
  ActualDeliveryDate: '2026-10-02 08:02:03',
  TrackingUpdateDate: '2026-10-04 08:10:51',
};

/** The same parcel when the phone of a participant was passed: Nova Poshta adds the people. */
export const deliveredParcelWithPeople = {
  ...deliveredParcel,
  SenderFullNameEW: 'Тестовий Олег Іванович',
  CounterpartySenderDescription: 'Приватна особа',
  PhoneSender: '380441234567',
  RecipientFullName: 'Тестова Ірина',
  RecipientFullNameEW: 'Тестова Ірина Петрівна',
  CounterpartyRecipientDescription: 'Приватна особа',
  PhoneRecipient: '380501234567',
};

export const price = { Cost: 122.5, CostRedelivery: 50, AssessedCost: 1500 };

export const deliveryDate = { DeliveryDate: { date: '2026-10-13 11:30:00.000000', timezone_type: 3, timezone: 'Europe/Kiev' } };

/** The remark the API adds to public tracking for every number. */
export const phoneReminder = (number: string) => ({
  [`ID_${number}`]: 'Please enter a valid phone number from the express invoice to show full information',
});
