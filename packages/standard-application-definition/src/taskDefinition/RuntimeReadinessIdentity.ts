const UTF8 = new TextEncoder();
const MAX_IDENTITY_UTF8_BYTES = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export function isTaskRuntimeReadinessIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.trim() === value && !CONTROL_CHARACTERS.test(value) &&
    UTF8.encode(value).byteLength <= MAX_IDENTITY_UTF8_BYTES;
}
