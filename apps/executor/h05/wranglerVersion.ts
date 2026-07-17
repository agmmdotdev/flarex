export function isH05SupportedWranglerVersion(value: string): boolean {
  return /^4\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}
