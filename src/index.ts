#!/usr/bin/env node
/**
 * Entry point: `npx -y @myradostudio/novaposhta-mcp`.
 *
 * stdout carries the MCP protocol, so every diagnostic goes to stderr.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { NovaPoshtaClient } from './client.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { createServer } from './server.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

function log(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

function main(): void {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    log(error.message);
    log('See the README for the list of environment variables.');
    process.exitCode = 1;
    return;
  }
  for (const notice of config.notices) log(notice);

  const client = new NovaPoshtaClient({ config });

  const handle = serveStdio(() => createServer({ config, client }), {
    // Only the error type is logged: the message of a parse error can quote the
    // offending input, and tool arguments can contain phone numbers.
    onerror: (error) => log(`Transport error (${error.name}).`),
  });

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void handle
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const key = config.apiKey === undefined ? 'no API key' : 'with an API key';
  log(`v${SERVER_VERSION} listening on stdio; read-only; API ${config.apiUrl}; ${key}.`);
}

try {
  main();
} catch (error) {
  log(`Fatal: ${error instanceof Error ? error.message : 'unexpected error'}`);
  process.exitCode = 1;
}
