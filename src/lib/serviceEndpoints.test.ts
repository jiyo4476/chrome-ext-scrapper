import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JOB_TRACKER_API_ENDPOINT,
  DEFAULT_OAUTH2_ENDPOINT,
  resolveServiceEndpoint,
} from './serviceEndpoints';

describe('resolveServiceEndpoint', () => {
  it('normalizes a configured HTTP endpoint', () => {
    expect(
      resolveServiceEndpoint(
        '  https://api.example.com/base///  ',
        DEFAULT_JOB_TRACKER_API_ENDPOINT,
      ),
    ).toBe('https://api.example.com/base');
  });

  it.each([undefined, '', 'not a url', 'ftp://api.example.com'])(
    'falls back for an invalid endpoint: %s',
    (value) => {
      expect(
        resolveServiceEndpoint(value, DEFAULT_JOB_TRACKER_API_ENDPOINT),
      ).toBe(DEFAULT_JOB_TRACKER_API_ENDPOINT);
    },
  );

  it('supports the shared OAuth2 default', () => {
    expect(resolveServiceEndpoint(undefined, DEFAULT_OAUTH2_ENDPOINT)).toBe(
      DEFAULT_OAUTH2_ENDPOINT,
    );
  });
});
