/**
 * Error types and the single place where an error becomes text for the model.
 *
 * Tool handlers never let a stack trace reach the MCP client: `describeError`
 * turns any thrown value into a short, actionable message.
 */

/** The API answered `success: false`, or with a non-2xx status. */
export class NovaPoshtaApiError extends Error {
  /** HTTP status; the API answers 200 even for most errors. */
  readonly status: number;
  /** `errors` of the response, in the words of the API. */
  readonly errors: readonly string[];
  /** `errorCodes` of the response. */
  readonly codes: readonly string[];

  constructor(status: number, errors: readonly string[], codes: readonly string[] = []) {
    super(errors.join('; ') || 'The request was refused.');
    this.name = 'NovaPoshtaApiError';
    this.status = status;
    this.errors = errors;
    this.codes = codes;
  }
}

/** No usable HTTP response: the request timed out or the network failed. */
export class NovaPoshtaTransportError extends Error {
  readonly kind: 'timeout' | 'network';

  constructor(kind: 'timeout' | 'network', message: string) {
    super(message);
    this.name = 'NovaPoshtaTransportError';
    this.kind = kind;
  }
}

/** A response arrived but cannot be interpreted: a redirect, or a body that is not the JSON envelope. */
export class UnexpectedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnexpectedResponseError';
  }
}

/** A problem the tool itself detected (bad combination of arguments, unexpected response shape). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Hints for error codes observed on the live API on 2026-10-08. The texts of the
 * API are short ("User is undefined"), so the hint says what to do about it.
 */
const CODE_HINTS: Readonly<Record<string, string>> = {
  '20000201204': 'Nova Poshta does not accept the API key. Check NOVAPOSHTA_API_KEY, or remove it to use the public methods without a key.',
  '20000101582': 'This method needs a personal API key. Set NOVAPOSHTA_API_KEY.',
  '20000500652': 'Write the name in Ukrainian letters: the search does not accept Latin ones.',
  '20000500626': 'Pass the `Ref` of a settlement from search_settlements.',
  '20000900767': 'Pass the `DeliveryCity` of a settlement from search_settlements, or the `CityRef` of a branch.',
  '20000200106': 'city_sender_ref is not a city Nova Poshta knows. Use the `DeliveryCity` of a settlement from search_settlements.',
  '20000200103': 'city_recipient_ref is not a city Nova Poshta knows. Use the `DeliveryCity` of a settlement from search_settlements.',
  '20001401442': 'In the live check the API accepted only waybill numbers of 14 digits, for example 20450000000000.',
};

export function describeError(error: unknown): string {
  if (error instanceof NovaPoshtaApiError) {
    const where = error.status === 200 ? '' : ` (HTTP ${error.status})`;
    const lines = [`Nova Poshta API error${where}: ${error.message}`];
    const hints = new Set(error.codes.map((code) => CODE_HINTS[code]).filter((hint) => hint !== undefined));
    if (error.status === 429) hints.add('Too many requests. Wait before retrying.');
    lines.push(...hints);
    return lines.join('\n');
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected error.';
}
