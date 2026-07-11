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

  it('does not default omitted OAuth tokens in settings updates', () => {
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
        apiBaseUrl: 'http://localhost:3000',
        authentikBaseUrl: 'https://auth.yjimmy.dev',
        oauthClientId: 'job-tracker-extension',
        oauthScope: 'openid profile email',
        autoDetect: false,
      },
    });
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
