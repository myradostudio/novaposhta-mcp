import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigError, DEFAULT_API_URL, loadConfig } from '../src/config.js';

const KEY = '0123456789abcdef0123456789abcdef';

function problemsOf(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    assert.ok(error instanceof ConfigError, 'expected a ConfigError');
    return error.problems;
  }
  assert.fail('expected the configuration to be rejected');
}

describe('loadConfig', () => {
  it('starts with no configuration at all and says that it works without a key', () => {
    const config = loadConfig({});
    assert.equal(config.apiKey, undefined);
    assert.equal(config.apiUrl, DEFAULT_API_URL);
    assert.equal(config.apiUrl, 'https://api.novaposhta.ua');
    assert.equal(config.notices.length, 1);
    assert.match(config.notices[0] ?? '', /NOVAPOSHTA_API_KEY is not set: requests go without a key/);
    assert.match(config.notices[0] ?? '', /does not promise/);
  });

  it('takes the API key and then has nothing to remark', () => {
    const config = loadConfig({ NOVAPOSHTA_API_KEY: `  ${KEY}\n` });
    assert.equal(config.apiKey, KEY);
    assert.deepEqual(config.notices, []);
  });

  it('treats blank values as unset', () => {
    const config = loadConfig({ NOVAPOSHTA_API_KEY: '   ', NOVAPOSHTA_API_URL: '' });
    assert.equal(config.apiKey, undefined);
    assert.equal(config.apiUrl, DEFAULT_API_URL);
  });

  it('rejects a key with whitespace inside without repeating it', () => {
    const problems = problemsOf({ NOVAPOSHTA_API_KEY: `${KEY} extra` });
    assert.match(problems.join('\n'), /without spaces or line breaks/);
    assert.ok(!problems.join('\n').includes(KEY));
  });

  it('accepts another https origin and plain http for localhost only', () => {
    assert.equal(loadConfig({ NOVAPOSHTA_API_URL: 'https://np.example.com/' }).apiUrl, 'https://np.example.com');
    assert.equal(loadConfig({ NOVAPOSHTA_API_URL: 'http://127.0.0.1:8080' }).apiUrl, 'http://127.0.0.1:8080');
    assert.match(problemsOf({ NOVAPOSHTA_API_URL: 'http://np.example.com' }).join('\n'), /must use https/);
  });

  it('rejects an API URL with a path, a query, credentials or no scheme', () => {
    const cases: Record<string, RegExp> = {
      'https://api.novaposhta.ua/v2.0/json/': /origin only/,
      'https://api.novaposhta.ua/?x=1': /origin only/,
      'https://user:pass@api.novaposhta.ua': /must not contain credentials/,
      'api.novaposhta.ua': /not a valid URL/,
    };
    for (const [value, expected] of Object.entries(cases)) {
      assert.match(problemsOf({ NOVAPOSHTA_API_URL: value }).join('\n'), expected, value);
    }
  });

  it('reports every problem at once, as a list', () => {
    const problems = problemsOf({ NOVAPOSHTA_API_KEY: 'a b', NOVAPOSHTA_API_URL: 'ftp://x' });
    assert.equal(problems.length, 2);
    assert.throws(
      () => loadConfig({ NOVAPOSHTA_API_KEY: 'a b' }),
      (error: unknown) => error instanceof ConfigError && /^Invalid configuration:\n  - NOVAPOSHTA_API_KEY/.test(error.message),
    );
  });
});
