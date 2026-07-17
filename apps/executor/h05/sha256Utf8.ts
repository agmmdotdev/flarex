import { createHash } from "node:crypto";

export function h05Sha256Utf8(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
