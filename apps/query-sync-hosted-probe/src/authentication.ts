import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";

export function isConfiguredSecret(value: string | undefined): value is string {
  return isNonBlankString(value) && value === value.trim();
}

export async function hasExactBearerCapability(
  request: Request,
  expected: string,
): Promise<boolean> {
  const presented = request.headers.get("authorization");
  if (presented === null) return false;
  const encoder = new TextEncoder();
  return bytesEqualFullScan(
    encoder.encode(presented),
    encoder.encode(`Bearer ${expected}`),
  );
}
