/**
 * Builds the MCP server: wires every tool to the SDK with uniform result
 * rendering and error handling.
 */

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';

import type { NovaPoshtaClient } from './client.js';
import type { Config } from './config.js';
import { describeError } from './errors.js';
import { tools } from './tools/read.js';
import type { AnyTool, ToolContext, ToolOutput } from './tools/types.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface ServerDependencies {
  readonly config: Config;
  readonly client: NovaPoshtaClient;
}

function instructions(config: Config): string {
  return [
    'Unofficial, read-only MCP server for Nova Poshta (novaposhta.ua), a Ukrainian delivery company: parcel tracking, the directories of settlements, branches and parcel lockers, and estimates of delivery cost and date. It cannot create, change or cancel a waybill.',
    'Places are identified by GUIDs called Ref. A settlement from search_settlements carries two of them: `Ref` (the settlement, for search_warehouses and search_streets) and `DeliveryCity` (the city, for the estimate tools). Do not mix them up, and never invent a Ref: look it up.',
    'Names of settlements and streets are searched in Ukrainian letters. Money is in hryvnias, weight in kilograms; delivery estimates are in the Europe/Kyiv time zone.',
    'Tracking with a phone number returns personal data of the sender and the recipient; ask for the phone only when the user needs that detail.',
    config.apiKey === undefined
      ? 'No API key is configured: the server uses the public methods without a key.'
      : 'A personal API key is configured and is sent with every request.',
  ].join('\n');
}

function render(output: ToolOutput): CallToolResult {
  const parts: string[] = [];
  if (output.note !== undefined) parts.push(output.note);
  if (output.data !== undefined && output.data !== null) {
    parts.push(typeof output.data === 'string' ? output.data : JSON.stringify(output.data, null, 2));
  }
  if (parts.length === 0) parts.push('The Nova Poshta API returned an empty response.');
  return { content: [{ type: 'text', text: parts.join('\n\n') }] };
}

/** Runs a tool handler. Failures become `isError` results with a plain message, never a stack trace. */
export async function runTool(tool: AnyTool, args: Record<string, unknown>, context: ToolContext): Promise<CallToolResult> {
  try {
    return render(await tool.handler(args, context));
  } catch (error) {
    return { content: [{ type: 'text', text: describeError(error) }], isError: true };
  }
}

export function createServer({ config, client }: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: 'Nova Poshta (unofficial)', version: SERVER_VERSION },
    { instructions: instructions(config) },
  );
  const context: ToolContext = { config, client };

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      (args) => runTool(tool, args, context),
    );
  }

  return server;
}
