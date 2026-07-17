export function isH05CloudflareHexId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}
