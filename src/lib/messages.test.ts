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
