export function toOriginPermissionPattern(apiBaseUrl: string): string {
  const origin = new URL(apiBaseUrl).origin;
  return `${origin}/*`;
}
