import type { z } from 'zod';

import type { NovaPoshtaClient } from '../client.js';
import type { Config } from '../config.js';

export interface ToolContext {
  readonly client: NovaPoshtaClient;
  readonly config: Config;
}

/** What a tool handler returns; `server.ts` renders it as MCP text content. */
export interface ToolOutput {
  /** Short guidance for the model, placed before the data. */
  readonly note?: string;
  /** JSON-serialisable data. */
  readonly data?: unknown;
}

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface ToolDefinition<Schema extends z.ZodObject = z.ZodObject> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly annotations: ToolAnnotations;
  readonly handler: (args: z.infer<Schema>, context: ToolContext) => Promise<ToolOutput>;
}

/** A tool with its argument type erased, so tools with different schemas fit in one list. */
export type AnyTool = ToolDefinition<z.ZodObject>;

/** Identity helper that infers the handler's argument type from `inputSchema`. */
export function defineTool<Schema extends z.ZodObject>(tool: ToolDefinition<Schema>): AnyTool {
  return tool as unknown as AnyTool;
}

/**
 * Every tool of this server is a lookup or a calculation, and every one talks to
 * an external service, hence `openWorldHint: true`.
 */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
