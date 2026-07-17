export function isH05CloudflareApiToken(value: string): boolean {
  return (
    value.length >= 10 &&
    value === value.trim() &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}
