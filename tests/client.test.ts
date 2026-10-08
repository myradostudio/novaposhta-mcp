import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NovaPoshtaClient } from '../src/client.js';
import { describeError, NovaPoshtaApiError, NovaPoshtaTransportError, UnexpectedResponseError } from '../src/errors.js';
import { isCatalogued, METHODS } from '../src/methods.js';
import { FakeApi, failure, hang, json, ok } from './support/fake-api.js';
import { API_KEY, testConfig } from './support/harness.js';

function setup(overrides: Parameters<typeof testConfig>[0] = {}) {
  const api = new FakeApi();
  const client = new NovaPoshtaClient({ config: testConfig(overrides), fetch: api.fetch });
  return { api, client };
}

describe('requests', () => {
  it('posts the envelope to the one address of the API', async () => {
    const { api, client } = setup();
    api.on('AddressGeneral.getWarehouseTypes', ok([]));

    await client.call(METHODS.warehouseTypes);

    const { method, url, headers, redirect, body } = api.single;
    assert.equal(method, 'POST');
    assert.equal(url.href, 'https://api.novaposhta.test/v2.0/json/');
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers['accept'], 'application/json');
    assert.match(headers['user-agent'] ?? '', /^novaposhta-mcp\/\d+\.\d+\.\d+$/);
    assert.equal(redirect, 'manual');
    assert.deepEqual(body, { apiKey: '', modelName: 'AddressGeneral', calledMethod: 'getWarehouseTypes', methodProperties: {} });
  });

  it('sends the configured key in the body, never in a header or the URL', async () => {
    const { api, client } = setup({ apiKey: API_KEY });
    api.on('AddressGeneral.getWarehouseTypes', ok([]));

    await client.call(METHODS.warehouseTypes);

    const request = api.single;
    assert.equal(request.body['apiKey'], API_KEY);
    assert.ok(!JSON.stringify(request.headers).includes(API_KEY));
    assert.ok(!request.url.href.includes(API_KEY));
  });

  it('leaves out properties whose value is undefined', async () => {
    const { api, client } = setup();
    api.on('AddressGeneral.getWarehouses', ok([]));

    await client.call(METHODS.warehouses, { CityName: 'Бровари', CityRef: undefined, Limit: 20 });

    assert.deepEqual(api.single.properties, { CityName: 'Бровари', Limit: 20 });
  });

  it('returns the data, the total of a paged directory and the remarks of the API', async () => {
    const { api, client } = setup();
    api.on('AddressGeneral.getWarehouses', ok([{ Ref: 'a' }], { info: { totalCount: 410 }, warnings: ['DateTime is set to current'] }));

    const result = await client.call(METHODS.warehouses, { CityName: 'Бровари' });

    assert.deepEqual(result, { data: [{ Ref: 'a' }], totalCount: 410, warnings: ['DateTime is set to current'] });
  });

  it('has no total when the API sends an empty info list', async () => {
    const { api, client } = setup();
    api.on('AddressGeneral.getWarehouseTypes', ok([{ Ref: 'a' }]));

    assert.equal((await client.call(METHODS.warehouseTypes)).totalCount, undefined);
  });

  it('flattens the per-number remarks of tracking', async () => {
    const { api, client } = setup();
    api.on(
      'TrackingDocument.getStatusDocuments',
      ok([], { warnings: ['Invalid DocumentNumber: abc', { ID_20400000000000: 'Please enter a valid phone number' }] }),
    );

    const result = await client.call(METHODS.trackDocuments, { Documents: [] });

    assert.deepEqual(result.warnings, ['Invalid DocumentNumber: abc', '20400000000000: Please enter a valid phone number']);
  });
});

describe('the read-only catalogue', () => {
  it('holds lookups and calculations only', () => {
    const names = Object.values(METHODS).map((method) => `${method.model}.${method.method}`);
    assert.deepEqual(names, [
      'TrackingDocument.getStatusDocuments',
      'Address.searchSettlements',
      'Address.searchSettlementStreets',
      'AddressGeneral.getWarehouses',
      'AddressGeneral.getWarehouseTypes',
      'InternetDocument.getDocumentPrice',
      'InternetDocument.getDocumentDeliveryDate',
    ]);
    // The methods of the API that change something are named save, update, delete, insert.
    for (const name of names) assert.doesNotMatch(name, /\.(save|update|delete|insert|remove)/i, name);
  });

  it('refuses a method that is not in it, without sending anything', async () => {
    const { api, client } = setup();
    const save = { model: 'InternetDocument', method: 'save' };
    const lookAlike = { model: 'AddressGeneral', method: 'getWarehouseTypes' };

    await assert.rejects(client.call(save), /InternetDocument\.save is not in the catalogue of read-only methods/);
    await assert.rejects(client.call(lookAlike), /not in the catalogue/);

    assert.equal(isCatalogued(METHODS.warehouseTypes), true);
    assert.equal(isCatalogued(lookAlike), false);
    assert.equal(api.requests.length, 0);
  });

  it('cannot be rewritten after the check: its entries are frozen', () => {
    for (const method of Object.values(METHODS)) assert.ok(Object.isFrozen(method), `${method.model}.${method.method}`);
    assert.throws(() => {
      (METHODS.deliveryPrice as { method: string }).method = 'save';
    }, TypeError);
    assert.equal(METHODS.deliveryPrice.method, 'getDocumentPrice');
  });
});

describe('failures', () => {
  it('turns success: false into NovaPoshtaApiError with the words and the codes of the API', async () => {
    const { api, client } = setup();
    api.on('InternetDocument.getDocumentPrice', failure(['Weight is invalid', 'VolumeGeneral is invalid'], ['20000200373', '20000200365']));

    const error = await client.call(METHODS.deliveryPrice, {}).catch((e: unknown) => e);

    assert.ok(error instanceof NovaPoshtaApiError);
    assert.equal(error.status, 200);
    assert.deepEqual(error.errors, ['Weight is invalid', 'VolumeGeneral is invalid']);
    assert.deepEqual(error.codes, ['20000200373', '20000200365']);
    assert.equal(describeError(error), 'Nova Poshta API error: Weight is invalid; VolumeGeneral is invalid');
  });

  it('adds a hint for the codes it knows', async () => {
    const { api, client } = setup({ apiKey: API_KEY });
    api.on('Address.searchSettlements', failure(['API key expired'], ['20000201204']));

    const error = await client.call(METHODS.searchSettlements, { CityName: 'Київ' }).catch((e: unknown) => e);

    assert.equal(
      describeError(error),
      'Nova Poshta API error: API key expired\nNova Poshta does not accept the API key. Check NOVAPOSHTA_API_KEY, or remove it to use the public methods without a key.',
    );
  });

  it('takes the reason from the warnings when the API leaves errors empty', async () => {
    const { api, client } = setup();
    api.on('AddressGeneral.getWarehouseTypes', failure([], [], { warnings: ['Model is invalid'] }));

    const error = await client.call(METHODS.warehouseTypes).catch((e: unknown) => e);

    assert.equal(describeError(error), 'Nova Poshta API error: Model is invalid');
  });

  it('still says something when the API gives no reason at all', async () => {
    const { api, client } = setup();
    api.on('AddressGeneral.getWarehouseTypes', failure([]));

    assert.equal(describeError(await client.call(METHODS.warehouseTypes).catch((e: unknown) => e)), 'Nova Poshta API error: The request was refused.');
  });

  it('removes the API key from anything the API echoes back', async () => {
    const { api, client } = setup({ apiKey: API_KEY });
    api.on('AddressGeneral.getWarehouseTypes', failure([`Key ${API_KEY} is blocked`], [], { warnings: [`apiKey=${API_KEY}`] }));

    const text = describeError(await client.call(METHODS.warehouseTypes).catch((e: unknown) => e));

    assert.equal(text, 'Nova Poshta API error: Key [redacted] is blocked');
  });

  it('reports an HTTP error that is not JSON with its status and a truncated text', async () => {
    const { api, client } = setup();
    api.on('*', new Response(`<html>${'x'.repeat(2_000)}</html>`, { status: 502 }));

    const error = await client.call(METHODS.warehouseTypes).catch((e: unknown) => e);

    assert.ok(error instanceof NovaPoshtaApiError);
    assert.equal(error.status, 502);
    assert.equal(error.message.length, 500);
    assert.match(describeError(error), /^Nova Poshta API error \(HTTP 502\): <html>/);
  });

  it('keeps the status and the hint when an HTTP error carries JSON of another shape', async () => {
    const { api, client } = setup();
    api.on('*', json({ message: 'Too Many Requests' }, 429));

    const error = await client.call(METHODS.warehouseTypes).catch((e: unknown) => e);

    assert.ok(error instanceof NovaPoshtaApiError);
    assert.equal(error.status, 429);
    assert.equal(describeError(error), 'Nova Poshta API error (HTTP 429): {"message":"Too Many Requests"}\nToo many requests. Wait before retrying.');
  });

  it('removes the key from an answer before anything is cut or parsed', async () => {
    const { api, client } = setup({ apiKey: API_KEY });
    // The key starts inside the first 500 characters and ends after them.
    api.on('AddressGeneral.getWarehouseTypes', new Response(`${'x'.repeat(490)}${API_KEY} tail`, { status: 500 }));
    api.on('AddressGeneral.getWarehouses', ok([{ Description: `echo ${API_KEY}` }], { warnings: [`key ${API_KEY}`] }));

    const error = await client.call(METHODS.warehouseTypes).catch((e: unknown) => e);
    const result = await client.call(METHODS.warehouses, { CityName: 'Київ' });

    assert.ok(error instanceof NovaPoshtaApiError);
    assert.ok(!error.message.includes(API_KEY.slice(0, 8)), 'not even the beginning of the key survives the cut');
    assert.match(error.message, /\[redacted\]$/);
    assert.deepEqual(result.data, [{ Description: 'echo [redacted]' }]);
    assert.deepEqual(result.warnings, ['key [redacted]']);
  });

  it('suggests waiting on HTTP 429', async () => {
    const { api, client } = setup();
    api.on('*', json({ success: false, data: [], errors: ['Too many requests'], errorCodes: [] }, 429));

    const text = describeError(await client.call(METHODS.warehouseTypes).catch((e: unknown) => e));

    assert.equal(text, 'Nova Poshta API error (HTTP 429): Too many requests\nToo many requests. Wait before retrying.');
  });

  it('does not follow a redirect and says what to check', async () => {
    const { api, client } = setup();
    api.on('*', new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }));

    const error = await client.call(METHODS.warehouseTypes).catch((e: unknown) => e);

    assert.ok(error instanceof UnexpectedResponseError);
    assert.match(error.message, /redirect \(HTTP 302\)/);
    assert.match(error.message, /NOVAPOSHTA_API_URL/);
    assert.equal(api.requests.length, 1);
  });

  it('reports a success status with a body that is not the envelope', async () => {
    const { api, client } = setup();
    api.on('AddressGeneral.getWarehouseTypes', new Response('<html>ok</html>', { status: 200 }));
    api.on('AddressGeneral.getWarehouses', json([{ Ref: 'a' }]));

    await assert.rejects(client.call(METHODS.warehouseTypes), /not valid JSON/);
    await assert.rejects(client.call(METHODS.warehouses), (error: unknown) => {
      assert.ok(error instanceof UnexpectedResponseError);
      assert.match(error.message, /not a Nova Poshta response/);
      return true;
    });
  });

  it('times out instead of waiting forever', async () => {
    const client = new NovaPoshtaClient({ config: testConfig({ timeoutMs: 40 }), fetch: (_url, init) => hang(init) });

    const error = await client.call(METHODS.trackDocuments, { Documents: [] }).catch((e: unknown) => e);

    assert.ok(error instanceof NovaPoshtaTransportError);
    assert.equal(error.kind, 'timeout');
    assert.equal(error.message, 'TrackingDocument.getStatusDocuments timed out after 0.04 s.');
  });

  it('reports a network failure with its cause and without the key', async () => {
    const client = new NovaPoshtaClient({
      config: testConfig({ apiKey: API_KEY }),
      fetch: async () => {
        throw new TypeError(`fetch failed for ${API_KEY}`, { cause: { message: `connect ECONNREFUSED ${API_KEY}` } });
      },
    });

    const error = await client.call(METHODS.warehouseTypes).catch((e: unknown) => e);

    assert.ok(error instanceof NovaPoshtaTransportError);
    assert.equal(error.kind, 'network');
    assert.equal(
      error.message,
      'AddressGeneral.getWarehouseTypes failed: no usable response from https://api.novaposhta.test (connect ECONNREFUSED [redacted]).',
    );
  });
});
