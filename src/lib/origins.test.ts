import { describe, expect, it } from 'vitest';
import { toOriginPermissionPattern } from './origins';

describe('toOriginPermissionPattern', () => {
  it('converts a configured API URL to a Chrome host permission pattern', () => {
    expect(toOriginPermissionPattern('https://api.example.com/v1')).toBe(
      'https://api.example.com/*',
    );
  });

  it('preserves localhost ports', () => {
    expect(toOriginPermissionPattern('http://localhost:3000')).toBe(
      'http://localhost:3000/*',
    );
  });
});
