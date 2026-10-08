/**
 * Environment-based configuration.
 *
 * Everything is validated once at startup. Problems are collected and reported
 * together so a user fixing their MCP client config does not have to restart
 * the server once per mistake.
 */

export const DEFAULT_API_URL = 'https://api.novaposhta.ua';
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface Config {
  /** API origin without a trailing slash, e.g. `https://api.novaposhta.ua`. */
  readonly apiUrl: string;
  /** Personal API key from the Nova Poshta business cabinet, sent as `apiKey`. Optional. */
  readonly apiKey: string | undefined;
  readonly timeoutMs: number;
  /** Non-fatal remarks to print on stderr at startup. Never contain secrets. */
  readonly notices: readonly string[];
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Reads a variable, treating blank values (common in config templates) as unset. */
function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function parseApiUrl(raw: string | undefined, problems: string[]): string {
  if (raw === undefined) return DEFAULT_API_URL;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`NOVAPOSHTA_API_URL is not a valid URL (expected something like ${DEFAULT_API_URL}).`);
    return DEFAULT_API_URL;
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    problems.push('NOVAPOSHTA_API_URL must use https:// (plain http:// is accepted only for localhost).');
  }
  if (url.username !== '' || url.password !== '') {
    problems.push('NOVAPOSHTA_API_URL must not contain credentials.');
  }
  if (url.pathname.replace(/\/+$/, '') !== '' || url.search !== '' || url.hash !== '') {
    problems.push(
      `NOVAPOSHTA_API_URL must be the API origin only, without a path or query (for example ${DEFAULT_API_URL}).`,
    );
  }
  return url.origin;
}

/**
 * Builds the configuration from environment variables.
 * @throws {ConfigError} listing every problem found.
 */
export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const notices: string[] = [];

  const apiKey = read(env, 'NOVAPOSHTA_API_KEY');
  if (apiKey !== undefined && /\s/.test(apiKey)) {
    problems.push('NOVAPOSHTA_API_KEY must be the API key alone, without spaces or line breaks.');
  }
  const apiUrl = parseApiUrl(read(env, 'NOVAPOSHTA_API_URL'), problems);

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  if (apiKey === undefined) {
    notices.push(
      'NOVAPOSHTA_API_KEY is not set: requests go without a key. The public methods this server uses answered that way when it was written; Nova Poshta does not promise they always will.',
    );
  }

  return { apiUrl, apiKey, timeoutMs: DEFAULT_TIMEOUT_MS, notices };
}
