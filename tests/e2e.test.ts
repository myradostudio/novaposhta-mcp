/**
 * End to end: the built server (dist/index.js) is started as a child process,
 * exactly as an MCP host starts it, and driven over stdio. The Nova Poshta API is
 * a local HTTP server on 127.0.0.1, so nothing leaves the machine.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Compiled to build-test/tests/e2e.test.js; the server build is in dist/.
const SERVER_ENTRY = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

const KEY = 'e2e0api0key0do0not0log0000000000';

const TOOLS = [
  'track_parcels',
  'search_settlements',
  'search_warehouses',
  'list_warehouse_types',
  'search_streets',
  'estimate_delivery_cost',
  'estimate_delivery_date',
];

interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: Record<string, any>;
}

let api: Server;
let apiUrl: string;
const apiCalls: ApiCall[] = [];

before(async () => {
  api = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, any>;
      apiCalls.push({ method: request.method ?? '', path: request.url ?? '', headers: request.headers, body });
      const reply = (payload: Record<string, unknown>) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ errors: [], warnings: [], info: [], errorCodes: [], ...payload }));
      };
      if (`${body['modelName']}.${body['calledMethod']}` === 'TrackingDocument.getStatusDocuments') {
        reply({
          success: true,
          data: [{ Number: body['methodProperties'].Documents[0].DocumentNumber, StatusCode: '3', Status: 'Номер не знайдено', PhoneSender: '', AmountPaid: 0 }],
        });
      } else {
        reply({ success: false, data: [], warnings: ['Model is invalid'] });
      }
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => api.close(resolve));
});

function serverEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { ...getDefaultEnvironment(), NOVAPOSHTA_API_URL: apiUrl, ...extra };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

describe('stdio server process', () => {
  it('serves an MCP client without a key: lists the tools and tracks a parcel', async () => {
    apiCalls.length = 0;
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], env: serverEnv(), stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // "legacy" is the 2025-era handshake, spoken by every host that has not moved to the 2026 protocol.
    const client = new Client({ name: 'e2e-test', version: '1.0.0' }, { versionNegotiation: { mode: 'legacy' } });
    await client.connect(transport);
    assert.match(client.getNegotiatedProtocolVersion() ?? '', /^2025-/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), TOOLS);
    assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true), 'every tool is read-only');
    assert.equal(apiCalls.length, 0, 'listing tools must not contact the API');

    const result = await client.callTool({ name: 'track_parcels', arguments: { numbers: ['2040 0000 0000 00'] } });
    const content = result.content as { type: string; text: string }[];
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(content[0]!.text), {
      returned: 1,
      parcels: [{ found: false, Number: '20400000000000', StatusCode: '3', Status: 'Номер не знайдено' }],
    });

    const [call] = apiCalls;
    assert.equal(apiCalls.length, 1);
    assert.equal(`${call?.method} ${call?.path}`, 'POST /v2.0/json/');
    assert.equal(call?.headers['content-type'], 'application/json');
    assert.match(String(call?.headers['user-agent']), /^novaposhta-mcp\/\d+\.\d+\.\d+$/);
    assert.deepEqual(call?.body, {
      apiKey: '',
      modelName: 'TrackingDocument',
      calledMethod: 'getStatusDocuments',
      methodProperties: { Documents: [{ DocumentNumber: '20400000000000', Phone: '' }] },
    });

    await client.close();

    assert.match(stderr, /\[novaposhta-mcp\] NOVAPOSHTA_API_KEY is not set: requests go without a key/);
    assert.match(stderr, /\[novaposhta-mcp\] v\d+\.\d+\.\d+ listening on stdio; read-only; API http:\/\/127\.0\.0\.1:\d+; no API key\./);
  });

  it('sends the key when one is configured, also for a client of the 2026 protocol, and never logs it', async () => {
    apiCalls.length = 0;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRY],
      env: serverEnv({ NOVAPOSHTA_API_KEY: KEY }),
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // "auto" negotiates the newest protocol revision; the first test used the 2025-era handshake.
    const client = new Client({ name: 'e2e-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(transport);

    const protocolVersion = client.getNegotiatedProtocolVersion() ?? '';
    const { tools } = await client.listTools();
    const tracked = await client.callTool({ name: 'track_parcels', arguments: { numbers: ['20400000000000'], phone: '+380501234567' } });
    const refused = await client.callTool({ name: 'list_warehouse_types', arguments: {} });
    await client.close();

    assert.ok(protocolVersion >= '2026-07-28', `negotiated ${protocolVersion}`);
    assert.equal(tools.length, TOOLS.length, 'a key adds no tools: the server has no write tools');
    assert.notEqual(tracked.isError, true);
    assert.equal(refused.isError, true);
    assert.equal((refused.content as { text: string }[])[0]!.text, 'Nova Poshta API error: Model is invalid');
    assert.equal(apiCalls.length, 2);
    assert.ok(apiCalls.every((call) => call.body['apiKey'] === KEY), 'the key goes in the body of every request');
    assert.equal(apiCalls[0]?.body['methodProperties'].Documents[0].Phone, '380501234567');
    assert.match(stderr, /listening on stdio; read-only; API http:\/\/127\.0\.0\.1:\d+; with an API key\./);
    assert.ok(!stderr.includes(KEY), 'the key must never be written to stderr');
    assert.ok(!stderr.includes('380501234567'), 'a phone number must never be written to stderr');
  });

  it('speaks plain JSON-RPC to a 2025-era client, keeps stdout clean and exits when stdin closes', async () => {
    const child = spawn(process.execPath, [SERVER_ENTRY], { env: serverEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));

    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw-client', version: '1.0.0' } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    const answered = await waitFor(() => stdout.split('\n').filter(Boolean).length >= 2, 10_000);
    assert.ok(answered, 'the server answered both requests');
    child.stdin.end();
    const exitCode = await Promise.race([exited, new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 5_000))]);
    if (exitCode === 'timeout') child.kill();

    const messages = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> });
    assert.equal(messages.length, 2, 'stdout carries protocol messages only');
    assert.equal(messages[0]?.id, 1);
    assert.equal(messages[0]?.result['protocolVersion'], '2025-06-18');
    assert.equal(messages[1]?.id, 2);
    assert.equal((messages[1]?.result['tools'] as unknown[]).length, TOOLS.length);
    assert.equal(exitCode, 0, 'the process ends by itself once the client is gone');
  });

  it('refuses to start with a broken configuration: message on stderr, nothing on stdout, exit code 1', () => {
    const result = spawnSync(process.execPath, [SERVER_ENTRY], {
      env: { ...getDefaultEnvironment(), NOVAPOSHTA_API_KEY: 'two words', NOVAPOSHTA_API_URL: 'http://api.novaposhta.ua' },
      encoding: 'utf8',
      timeout: 15_000,
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\[novaposhta-mcp\] Invalid configuration:/);
    assert.match(result.stderr, /NOVAPOSHTA_API_KEY must be the API key alone/);
    assert.match(result.stderr, /NOVAPOSHTA_API_URL must use https/);
  });
});
