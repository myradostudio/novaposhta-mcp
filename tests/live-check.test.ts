/**
 * The live check itself, run as the command a person runs: scripts/live-check.mjs
 * is started as a child process and finds, through NOVAPOSHTA_API_URL, a local
 * stand-in instead of api.novaposhta.ua. The stand-in applies the filters it is
 * sent, so the run passes; each rule of the script then gets a case in which the
 * run has to fail, or in which something must not appear in the output.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

import { assertMatchesContract } from './support/contract.js';
import { failure, ok, type FakeApi } from './support/fake-api.js';
import * as fixtures from './support/fixtures.js';
import { NUMBERS } from './support/fixtures.js';
import { serve } from './support/http-bridge.js';
import { answers, liveWorld, PARTICIPANT_PHONE } from './support/live-world.js';

// Compiled to build-test/tests/live-check.test.js; the script and the server build are two levels up.
const SCRIPT = fileURLToPath(new URL('../../scripts/live-check.mjs', import.meta.url));

const KEY = 'live0check0key0do0not0print00000';
/** The checks of a run without a waybill. A check that silently disappears changes this number. */
const CHECKS = 23;

interface Run {
  readonly code: number | null;
  /** stdout and stderr together: nothing secret may be in either. */
  readonly output: string;
  readonly lines: readonly string[];
}

/** Runs the script against the stand-in. `input` is what the person would type, one answer per line. */
async function liveCheck(api: FakeApi, args: string[] = [], options: { input?: string; env?: Record<string, string> } = {}): Promise<Run> {
  const bridge = await serve(api);
  try {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...getDefaultEnvironment(), NOVAPOSHTA_API_URL: bridge.url, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => (output += chunk));
    }
    child.stdin.end(options.input ?? '');
    const code = await new Promise<number | null>((resolve) => child.once('close', resolve));
    return { code, output, lines: output.split('\n').filter((line) => line !== '') };
  } finally {
    await bridge.close();
  }
}

const marked = (run: Run, mark: string) => run.lines.filter((line) => line.startsWith(`${mark}  `));

describe('live check against a stand-in for the API', { concurrency: true }, () => {
  it('passes when the API applies every filter: PASS lines only, exit code 0, requests within the contract', async () => {
    const api = liveWorld();
    const run = await liveCheck(api);

    assert.equal(run.code, 0, run.output);
    assert.match(run.lines[0] ?? '', /^Nova Poshta live check, \d{4}-\d{2}-\d{2}, without an API key$/);
    assert.equal(marked(run, 'PASS').length, CHECKS, run.output);
    assert.deepEqual(marked(run, 'FAIL'), []);
    assert.deepEqual(marked(run, 'SKIP'), []);
    assert.equal(run.lines.at(-1), 'All checks passed.');
    // The script is where the contract comes from, so it must stay inside it itself.
    assert.ok(api.requests.length > CHECKS);
    for (const request of api.requests) assertMatchesContract(request, '');
  });

  it('fails with exit code 1 when the API does not apply a filter', async () => {
    const api = liveWorld();
    // The number of the branch is dropped, as if the API ignored it.
    api.on('AddressGeneral.getWarehouses', (request) =>
      answers['AddressGeneral.getWarehouses']!({ ...request, properties: { ...request.properties, WarehouseId: undefined } }),
    );
    const run = await liveCheck(api);

    assert.equal(run.code, 1);
    assert.deepEqual(marked(run, 'FAIL'), ['FAIL  search_warehouses: city_name, number — number was not applied: other numbers came back']);
    // The check that needed the branch of the failed one says so, instead of failing on its own.
    assert.deepEqual(marked(run, 'SKIP'), ['SKIP  search_warehouses: warehouse_ref — needs the branch found by its number, which an earlier step did not give']);
    assert.equal(marked(run, 'PASS').length, CHECKS - 2);
    assert.equal(run.lines.at(-1), '1 check(s) failed, 1 skipped.');
  });

  it('fails with the text of the API when a method is refused', async () => {
    const api = liveWorld();
    api.on('InternetDocument.getDocumentDeliveryDate', failure(['Service is temporarily unavailable']));
    const run = await liveCheck(api);

    assert.equal(run.code, 1);
    const failed = marked(run, 'FAIL');
    assert.equal(failed.length, 3, run.output);
    for (const line of failed) {
      assert.match(line, /^FAIL  estimate_delivery_date: .* — (WarehouseWarehouse: )?Nova Poshta API error: Service is temporarily unavailable$/);
    }
    assert.equal(marked(run, 'PASS').length, CHECKS - 3);
    assert.equal(run.lines.at(-1), '3 check(s) failed.');
  });

  it('--ask-key: the key typed at the question goes to the API and never to the output', async () => {
    const api = liveWorld();
    // The API repeats the key in a remark that the check prints.
    api.on('InternetDocument.getDocumentDeliveryDate', (request) =>
      ok([fixtures.deliveryDate], { warnings: [`apiKey ${request.body['apiKey']} is accepted`] }),
    );
    const run = await liveCheck(api, ['--ask-key'], { input: `${KEY}\n` });

    assert.equal(run.code, 0, run.output);
    assert.match(run.lines[0] ?? '', /^Nova Poshta API key \(input is hidden; Enter to run without a key\): $/);
    assert.match(run.lines[1] ?? '', /, with an API key$/);
    assert.ok(api.requests.length > 0 && api.requests.every((request) => request.body['apiKey'] === KEY), 'every request carries the key');
    assert.match(run.output, /warnings: \["apiKey \[redacted\] is accepted"\]/);
    assert.ok(!run.output.includes(KEY), 'the key must not be printed');
    assert.equal(run.lines.at(-1), 'All checks passed.');
  });

  it('--ask-key replaces the key of the environment, and an empty answer means no key', async () => {
    const api = liveWorld();
    const run = await liveCheck(api, ['--ask-key'], { input: '\n', env: { NOVAPOSHTA_API_KEY: KEY } });

    assert.equal(run.code, 0, run.output);
    assert.match(run.lines[1] ?? '', /, without an API key$/);
    assert.ok(api.requests.every((request) => request.body['apiKey'] === ''));
  });

  it('takes the key from NOVAPOSHTA_API_KEY without asking, and does not print it', async () => {
    const api = liveWorld();
    const run = await liveCheck(api, [], { env: { NOVAPOSHTA_API_KEY: KEY } });

    assert.equal(run.code, 0, run.output);
    assert.match(run.lines[0] ?? '', /, with an API key$/);
    assert.ok(api.requests.every((request) => request.body['apiKey'] === KEY));
    assert.ok(!run.output.includes(KEY), 'the key must not be printed');
  });

  it('explains a key the server refuses to start with, without printing it', async () => {
    const api = liveWorld();
    const run = await liveCheck(api, ['--ask-key'], { input: 'two words\n' });

    assert.equal(run.code, 1);
    assert.match(run.output, /The server did not start\./);
    assert.match(run.output, /NOVAPOSHTA_API_KEY must be the API key alone/);
    assert.ok(!run.output.includes('two words'));
    assert.equal(api.requests.length, 0);
  });

  describe('--ask-waybill', () => {
    const typedNumber = `${NUMBERS.delivered.slice(0, 4)} ${NUMBERS.delivered.slice(4, 8)} ${NUMBERS.delivered.slice(8)}`;
    const typedPhone = '+380 (50) 123-45-67';
    const waybillLines = (run: Run) => run.lines.filter((line) => /track_parcels: (a waybill of your own|the same waybill|all_fields)/.test(line));

    it('tracks a real parcel and prints the names of its fields, never a value', async () => {
      assert.equal(typedPhone.replace(/\D/g, ''), PARTICIPANT_PHONE);
      const api = liveWorld();
      const run = await liveCheck(api, ['--ask-waybill'], { input: `${typedNumber}\n${typedPhone}\n` });

      assert.equal(run.code, 0, run.output);
      assert.match(run.lines[2] ?? '', /, without an API key, with a waybill of your own$/);
      assert.equal(marked(run, 'PASS').length, CHECKS + 3);
      assert.deepEqual(waybillLines(run), [
        'PASS  track_parcels: a waybill of your own, without a phone — found; fields: Number, StatusCode, Status, DateCreated, ScheduledDeliveryDate, ActualDeliveryDate, RecipientDateTime, TrackingUpdateDate, CitySender, WarehouseSender, CityRecipient, WarehouseRecipient, WarehouseRecipientNumber, CategoryOfWarehouse, ServiceType, CargoType, SeatsAmount, DocumentWeight, FactualWeight, VolumeWeight, DocumentCost, PayerType, PaymentMethod, PaymentStatus, AmountPaid; of people: none',
        'PASS  track_parcels: the same waybill with the phone of a participant — found; of people: SenderFullNameEW, CounterpartySenderDescription, PhoneSender, RecipientFullName, RecipientFullNameEW, CounterpartyRecipientDescription, PhoneRecipient; the phone added: SenderFullNameEW, CounterpartySenderDescription, PhoneSender, RecipientFullName, RecipientFullNameEW, CounterpartyRecipientDescription, PhoneRecipient',
        'PASS  track_parcels: all_fields returns what the compact view leaves out — 35 fields against 32; only in the full view: CheckWeight, CounterpartySenderType, Edit',
      ]);

      // The number and the phone went to the API as they are needed there…
      const sent = api.requests.filter((request) => request.properties['Documents']?.[0]?.DocumentNumber === NUMBERS.delivered);
      assert.deepEqual(
        sent.map((request) => request.properties['Documents'][0].Phone),
        ['', PARTICIPANT_PHONE, PARTICIPANT_PHONE],
      );
      for (const request of api.requests) assertMatchesContract(request, '');

      // …and neither they nor anything the parcel holds reached the output.
      for (const typed of [NUMBERS.delivered, typedNumber, PARTICIPANT_PHONE, typedPhone, PARTICIPANT_PHONE.slice(-10)]) {
        assert.ok(!run.output.includes(typed), `the output holds what was typed: ${typed}`);
      }
      const fieldNames = Object.keys(fixtures.deliveredParcelWithPeople);
      const values = Object.values(fixtures.deliveredParcelWithPeople)
        .map(String)
        // A value such as "Recipient" (who pays) is also a part of field names, which are meant to be printed.
        .filter((value) => value.trim().length >= 4 && !fieldNames.some((name) => name.includes(value)));
      assert.ok(values.includes('Тестова Ірина Петрівна') && values.includes('Відправлення отримано') && values.includes('Житомир'));
      for (const value of values) {
        assert.ok(!waybillLines(run).join('\n').includes(value), `the output holds a value of the parcel: ${value}`);
      }
    });

    it('fails when the phone does not belong to the waybill', async () => {
      const run = await liveCheck(liveWorld(), ['--ask-waybill'], { input: `${NUMBERS.delivered}\n380670000000\n` });

      assert.equal(run.code, 1);
      assert.deepEqual(marked(run, 'FAIL'), [
        'FAIL  track_parcels: the same waybill with the phone of a participant — the phone added no names, phones or addresses: Nova Poshta adds them only for the phone of the sender or the recipient of this waybill',
      ]);
      assert.ok(!run.output.includes('380670000000') && !run.output.includes(NUMBERS.delivered));
      assert.equal(run.lines.at(-1), '1 check(s) failed.');
    });

    it('hides the number and the phone when the API repeats them in a refusal', async () => {
      const api = liveWorld();
      api.on('TrackingDocument.getStatusDocuments', (request) => {
        const [document] = request.properties['Documents'];
        return document.DocumentNumber === NUMBERS.delivered && document.Phone !== ''
          ? failure([`Document ${document.DocumentNumber} is closed for ${document.Phone}`])
          : answers['TrackingDocument.getStatusDocuments']!(request);
      });
      const run = await liveCheck(api, ['--ask-waybill'], { input: `${typedNumber}\n${typedPhone}\n` });

      assert.equal(run.code, 1);
      assert.deepEqual(marked(run, 'FAIL'), [
        'FAIL  track_parcels: the same waybill with the phone of a participant — Nova Poshta API error: Document [hidden] is closed for [hidden]',
      ]);
      assert.ok(!run.output.includes(NUMBERS.delivered) && !run.output.includes(PARTICIPANT_PHONE));
    });

    it('fails when Nova Poshta does not know the number, and skips what needs the parcel', async () => {
      const run = await liveCheck(liveWorld(), ['--ask-waybill'], { input: '20450000000002\n380501234567\n' });

      assert.equal(run.code, 1);
      assert.deepEqual(marked(run, 'FAIL'), ['FAIL  track_parcels: a waybill of your own, without a phone — Nova Poshta does not know this number']);
      assert.equal(marked(run, 'SKIP').length, 2);
      assert.ok(!run.output.includes('20450000000002'));
      assert.equal(run.lines.at(-1), '1 check(s) failed, 2 skipped.');
    });

    it('tracks without a phone when none is given, and says that the phone check was skipped', async () => {
      const api = liveWorld();
      const run = await liveCheck(api, ['--ask-waybill'], { input: `${NUMBERS.delivered}\n\n` });

      assert.equal(run.code, 0, run.output);
      assert.deepEqual(marked(run, 'SKIP'), ['SKIP  track_parcels: the same waybill with the phone of a participant — no phone was given']);
      assert.equal(marked(run, 'PASS').length, CHECKS + 2);
      assert.equal(run.lines.at(-1), 'All checks that ran passed; 1 skipped, see the SKIP lines.');
    });

    it('reports the waybill check as skipped when no number is given', async () => {
      const api = liveWorld();
      const run = await liveCheck(api, ['--ask-waybill'], { input: '\n' });

      assert.equal(run.code, 0, run.output);
      assert.deepEqual(marked(run, 'SKIP'), ['SKIP  track_parcels: a waybill of your own — no number was given']);
      assert.equal(run.lines.at(-1), 'All checks that ran passed; 1 skipped, see the SKIP lines.');
      assert.ok(api.requests.every((request) => request.properties['Documents']?.[0]?.DocumentNumber !== NUMBERS.delivered));
    });
  });

  describe('documentation', () => {
    const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    for (const file of ['README.md', 'README.uk.md']) {
      it(`${file} names both live-check commands and no npm script that does not exist`, () => {
        const text = read(file);
        const named = [...text.matchAll(/npm run ([a-z:-]+)/g)].map((match) => match[1] ?? '');
        for (const name of named) assert.ok(name in scripts, `${file} names \`npm run ${name}\`, which package.json does not have`);
        for (const name of ['live-check', 'live-check:key']) assert.ok(named.includes(name), `${file} does not name \`npm run ${name}\``);
        for (const flag of ['--ask-key', '--ask-waybill']) assert.ok(text.includes(flag), `${file} does not name ${flag}`);
      });
    }

    it('the npm commands start the script with the arguments the documentation promises', () => {
      assert.equal(scripts['live-check'], 'npm run build && node scripts/live-check.mjs');
      assert.equal(scripts['live-check:key'], 'npm run build && node scripts/live-check.mjs --ask-key --ask-waybill');
    });
  });

  describe('a mistake in how the script is started ends it with exit code 2 before anything is sent', () => {
    const cases: [string, string[], string, RegExp][] = [
      ['an unknown argument, which is not repeated: it may be a key', ['--key', KEY], '', /^The script takes only --ask-key and --ask-waybill\./],
      ['something that is not a waybill number', ['--ask-waybill'], 'abc\n', /That is not a waybill number/],
      ['something that is not a phone', ['--ask-waybill'], `${NUMBERS.delivered}\n12345\n`, /That is not a phone number/],
    ];
    for (const [name, args, input, message] of cases) {
      it(name, async () => {
        const api = liveWorld();
        const run = await liveCheck(api, args, { input });

        assert.equal(run.code, 2, run.output);
        assert.match(run.lines.at(-1) ?? '', message);
        assert.equal(api.requests.length, 0);
        assert.deepEqual(marked(run, 'PASS'), []);
        assert.ok(!run.output.includes(KEY) && !run.output.includes(NUMBERS.delivered));
      });
    }
  });
});
