/**
 * Minimal client for the Nova Poshta API.
 *
 * The API has one address and wraps everything in an envelope:
 *
 *   POST /v2.0/json/  { apiKey, modelName, calledMethod, methodProperties }
 *   →  { success, data: [...], errors: [...], warnings: [...], info: {...}, errorCodes: [...] }
 *
 * It answers HTTP 200 for almost every error and reports the failure in
 * `success: false`.
 *
 * Responsibilities:
 *  - call only the methods of the catalogue (lookups and calculations);
 *  - apply a timeout to every request and never follow redirects;
 *  - turn failures into typed errors whose messages never contain the key.
 *
 * Nothing is logged here: tracking answers can contain names, phone numbers and
 * addresses and must not end up in a log file.
 */

import type { Config } from './config.js';
import { NovaPoshtaApiError, NovaPoshtaTransportError, UnexpectedResponseError } from './errors.js';
import { API_PATH, isCatalogued, type ApiMethod } from './methods.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface NovaPoshtaClientOptions {
  readonly config: Config;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
}

/** The useful parts of a successful answer. */
export interface ApiResult {
  readonly data: readonly unknown[];
  /** `info.totalCount`, which the paged directory methods report. */
  readonly totalCount: number | undefined;
  /** Remarks of the API, flattened to plain strings. */
  readonly warnings: readonly string[];
}

const MAX_ERROR_BODY_CHARS = 500;
const MAX_MESSAGES = 20;
const REDACTED = '[redacted]';

export class NovaPoshtaClient {
  private readonly config: Config;
  private readonly fetchImpl: FetchLike;

  constructor(options: NovaPoshtaClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  /**
   * Calls one method of the catalogue. Properties whose value is undefined are left out.
   * @throws {NovaPoshtaApiError} when the API answers `success: false`.
   */
  async call(method: ApiMethod, properties: Readonly<Record<string, unknown>> = {}): Promise<ApiResult> {
    if (!isCatalogued(method)) {
      // Unreachable through the tools; guards the read-only promise against a future mistake.
      throw new Error(`${method.model}.${method.method} is not in the catalogue of read-only methods.`);
    }

    const name = `${method.model}.${method.method}`;
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': `${SERVER_NAME}/${SERVER_VERSION}`,
      },
      body: JSON.stringify({
        // The public methods answer with an empty key as well.
        apiKey: this.config.apiKey ?? '',
        modelName: method.model,
        calledMethod: method.method,
        methodProperties: Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined)),
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
      // A redirect would forward the API key to another host. That may not happen silently.
      redirect: 'manual',
    };

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(this.config.apiUrl + API_PATH, init);
      text = await response.text();
    } catch (error) {
      throw this.toTransportError(name, error);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new UnexpectedResponseError(
        `${name} was answered with a redirect (HTTP ${response.status}), which the server does not follow. Check that NOVAPOSHTA_API_URL is the API origin itself.`,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      if (!response.ok) {
        const excerpt = this.scrub(text.trim()).slice(0, MAX_ERROR_BODY_CHARS) || response.statusText || 'Empty error response.';
        throw new NovaPoshtaApiError(response.status, [excerpt]);
      }
      throw new UnexpectedResponseError(`${name} was answered with HTTP ${response.status} and a body that is not valid JSON.`);
    }

    if (!isObject(body) || typeof body['success'] !== 'boolean') {
      throw new UnexpectedResponseError(`${name} was answered with HTTP ${response.status} and a body that is not a Nova Poshta response.`);
    }

    const warnings = messages(body['warnings']).map((line) => this.scrub(line));
    if (body['success'] === false || !response.ok) {
      const errors = messages(body['errors']).map((line) => this.scrub(line));
      // An unknown model or method is reported in `warnings` with empty `errors`.
      throw new NovaPoshtaApiError(response.status, errors.length > 0 ? errors : warnings, strings(body['errorCodes']));
    }

    const info = body['info'];
    const totalCount = isObject(info) && typeof info['totalCount'] === 'number' ? info['totalCount'] : undefined;
    return { data: Array.isArray(body['data']) ? body['data'] : [], totalCount, warnings };
  }

  private toTransportError(name: string, error: unknown): NovaPoshtaTransportError {
    if (isTimeout(error)) {
      return new NovaPoshtaTransportError('timeout', `${name} timed out after ${this.config.timeoutMs / 1000} s.`);
    }
    return new NovaPoshtaTransportError(
      'network',
      this.scrub(`${name} failed: no usable response from ${this.config.apiUrl} (${networkCause(error)}).`),
    );
  }

  /** Defence in depth: removes the API key from any text that leaves the client. */
  private scrub(text: string): string {
    const { apiKey } = this.config;
    return apiKey !== undefined && apiKey.length >= 4 ? text.split(apiKey).join(REDACTED) : text;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_MESSAGES) : [];
}

/**
 * `errors` and `warnings` are lists of strings, except that tracking puts
 * objects such as `{ "ID_20450000000000": "…" }` into `warnings`.
 */
function messages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') lines.push(item);
    else if (isObject(item)) {
      for (const [key, text] of Object.entries(item)) {
        if (typeof text === 'string') lines.push(`${key.replace(/^ID_/, '')}: ${text}`);
      }
    }
  }
  return lines.slice(0, MAX_MESSAGES).map((line) => line.slice(0, MAX_ERROR_BODY_CHARS));
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function networkCause(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  if (typeof cause?.code === 'string') return cause.code;
  if (typeof cause?.message === 'string') return cause.message;
  return error.message;
}
