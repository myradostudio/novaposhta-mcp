/**
 * In-memory stand-in for the Nova Poshta API: a `fetch` replacement that records
 * every request and answers by `Model.method`. No test touches the network.
 */

import type { FetchLike } from '../../src/client.js';

export interface RecordedRequest {
  readonly method: string;
  readonly url: URL;
  /** Header names are lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON body: `{ apiKey, modelName, calledMethod, methodProperties }`. */
  readonly body: Record<string, any>;
  /** The redirect mode the client asked for. */
  readonly redirect: RequestInit['redirect'];
  /** `Model.method`, the key the routes are registered under. */
  readonly called: string;
  /** Shortcut to `body.methodProperties`. */
  readonly properties: Record<string, any>;
}

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

const EMPTY_LISTS = { errors: [], warnings: [], info: [], messageCodes: [], errorCodes: [], warningCodes: [], infoCodes: [] };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A successful answer in the envelope of the API. `extra` overrides `warnings`, `info` and the like. */
export function ok(data: unknown[], extra: Record<string, unknown> = {}): Response {
  return json({ success: true, data, ...EMPTY_LISTS, ...extra });
}

/** A refusal: HTTP 200 with `success: false`, as the API answers. */
export function failure(errors: string[], errorCodes: string[] = [], extra: Record<string, unknown> = {}): Response {
  return json({ success: false, data: [], ...EMPTY_LISTS, errors, errorCodes, ...extra });
}

/** A request that never completes by itself: it rejects when the client aborts it, as `fetch` does. */
export function hang(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    // AbortSignal.timeout() uses an unref'd timer, so something else has to keep the process alive meanwhile.
    const keepAlive = setTimeout(() => undefined, 60_000);
    init.signal?.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(init.signal?.reason);
    });
  });
}

function replay(template: Response): Responder {
  const body = template.text();
  return async () => {
    const content = await body;
    return new Response(content === '' ? null : content, { status: template.status, headers: template.headers });
  };
}

export class FakeApi {
  readonly requests: RecordedRequest[] = [];
  private readonly routes = new Map<string, Responder>();

  /**
   * Registers the answer for `Model.method`, or for every call with `*`.
   * A fixed `Response` is turned into a template: every call gets a fresh copy.
   */
  on(called: string, respond: Responder | Response): this {
    this.routes.set(called, typeof respond === 'function' ? respond : replay(respond));
    return this;
  }

  readonly fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, any>) : {};
    const request: RecordedRequest = {
      method: init.method ?? 'GET',
      url: new URL(url),
      headers,
      body,
      redirect: init.redirect,
      called: `${body['modelName']}.${body['calledMethod']}`,
      properties: body['methodProperties'] ?? {},
    };
    this.requests.push(request);

    const route = this.routes.get(request.called) ?? this.routes.get('*');
    if (route === undefined) {
      throw new Error(`FakeApi: no answer registered for ${request.called}`);
    }
    return route(request);
  };

  /** The only request recorded so far; fails the test when there is not exactly one. */
  get single(): RecordedRequest {
    if (this.requests.length !== 1) {
      throw new Error(`FakeApi: expected exactly one request, got ${this.requests.length}`);
    }
    return this.requests[0] as RecordedRequest;
  }
}
