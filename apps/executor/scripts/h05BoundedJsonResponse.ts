import {
  readH05BoundedResponseBody,
} from "./h05BoundedResponseBody";
import {
  decodeH05JsonBytesOrThrow,
  type H05JsonBytesDecodeFailure,
} from "./h05JsonBytes";

export interface H05BoundedJsonResponseFailurePolicy {
  readonly createSizeError: () => Error;
  readonly mapReadFailure: (cause: unknown) => Error;
  readonly mapDecodeFailure: (
    failure: H05JsonBytesDecodeFailure,
  ) => Error;
}

/** Reads and decodes one bounded foreign H05 JSON response body. */
export async function readH05BoundedJsonResponse(
  response: Response,
  maximumResponseBytes: number,
  failures: H05BoundedJsonResponseFailurePolicy,
): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readH05BoundedResponseBody(
      response,
      maximumResponseBytes,
      failures.createSizeError,
    );
  } catch (cause) {
    throw failures.mapReadFailure(cause);
  }
  return decodeH05JsonBytesOrThrow(bytes, failures.mapDecodeFailure);
}
