import { describe, expect, it } from 'vitest';
import { extensionMessageSchema, extensionResponseSchema } from './messages';

describe('extension message contracts', () => {
  it('accepts save requests with a job draft', () => {
    expect(
      extensionMessageSchema.parse({
        type: 'SAVE_JOB',
        draft: {
          source_platform: 'indeed',
          external_job_id: 'abc123',
          company_name: 'Acme',
          job_title: 'Software Engineer',
          job_link: 'https://example.com/jobs/abc123',
        },
      }),
    ).toMatchObject({ type: 'SAVE_JOB' });
  });

  it('accepts test connection requests and responses', () => {
    expect(extensionMessageSchema.parse({ type: 'TEST_CONNECTION' })).toEqual({
      type: 'TEST_CONNECTION',
    });
    expect(
      extensionResponseSchema.parse({
        type: 'TEST_CONNECTION_RESULT',
        ok: true,
      }),
    ).toEqual({ type: 'TEST_CONNECTION_RESULT', ok: true });
  });

  it('accepts the dedicated OAuth sign-in response', () => {
    expect(
      extensionResponseSchema.parse({
        type: 'OAUTH_SIGN_IN_RESULT',
        ok: true,
      }),
    ).toEqual({ type: 'OAUTH_SIGN_IN_RESULT', ok: true });
  });

  it('strips protected fields from public settings updates', () => {
    expect(
      extensionMessageSchema.parse({
        type: 'SAVE_SETTINGS',
        settings: {
          apiBaseUrl: 'http://localhost:3000',
          authentikBaseUrl: 'https://auth.yjimmy.dev',
          oauthClientId: 'job-tracker-extension',
          oauthScope: 'openid profile email',
          autoDetect: false,
        },
      }),
    ).toEqual({
      type: 'SAVE_SETTINGS',
      settings: {
        autoDetect: false,
      },
    });
  });

  it('never returns OAuth credentials through public settings responses', () => {
    expect(
      extensionResponseSchema.parse({
        type: 'GET_SETTINGS_RESULT',
        ok: true,
        settings: {
          apiBaseUrl: 'http://localhost:3000',
          autoDetect: false,
          oauthAccessToken: 'secret-access-token',
          oauthRefreshToken: 'secret-refresh-token',
        },
      }),
    ).toEqual({
      type: 'GET_SETTINGS_RESULT',
      ok: true,
      settings: {
        apiBaseUrl: 'http://localhost:3000',
        autoDetect: false,
      },
    });
  });

  it('accepts the dedicated OAuth sign-out contract', () => {
    expect(extensionMessageSchema.parse({ type: 'OAUTH_SIGN_OUT' })).toEqual({
      type: 'OAUTH_SIGN_OUT',
    });
    expect(
      extensionResponseSchema.parse({
        type: 'OAUTH_SIGN_OUT_RESULT',
        ok: true,
      }),
    ).toEqual({ type: 'OAUTH_SIGN_OUT_RESULT', ok: true });
  });

  it('rejects unexpected message types at runtime boundaries', () => {
    expect(() =>
      extensionMessageSchema.parse({ type: 'DELETE_EVERYTHING' }),
    ).toThrow();
  });

  it('accepts structured extension errors', () => {
    expect(
      extensionResponseSchema.parse({
        type: 'ERROR',
        ok: false,
        error: {
          code: 'API_AUTH_FAILED',
          message: 'The Job Tracker API rejected these credentials.',
        },
      }),
    ).toMatchObject({ ok: false });
  });
});
