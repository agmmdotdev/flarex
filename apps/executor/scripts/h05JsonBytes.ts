import { Result } from "effect";

const H05_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export type H05JsonBytesDecodeFailure = "invalidUtf8" | "invalidJson";

export function decodeH05JsonBytes(
  bytes: Uint8Array,
): Result.Result<unknown, H05JsonBytesDecodeFailure> {
  let text: string;
  try {
    text = H05_UTF8_DECODER.decode(bytes);
  } catch {
    return Result.fail("invalidUtf8");
  }

  try {
    const value: unknown = JSON.parse(text);
    return Result.succeed(value);
  } catch {
    return Result.fail("invalidJson");
  }
}

export function decodeH05JsonBytesOrThrow(
  bytes: Uint8Array,
  onFailure: (failure: H05JsonBytesDecodeFailure) => Error,
): unknown {
  return Result.getOrThrowWith(decodeH05JsonBytes(bytes), onFailure);
}
