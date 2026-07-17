export function isH05ControlPlaneCloudflareResourceId(
  value: string,
): boolean {
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}
