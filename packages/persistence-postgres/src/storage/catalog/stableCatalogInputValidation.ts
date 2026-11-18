import { isNonBlankString } from "@flarex/utils/strings";
import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Result, Schema } from "effect";

const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  CatalogTableIdSchema,
);

export function validateStableCatalogNonBlankInputResult<Failure>(
  value: unknown,
  onInvalid: () => Failure,
): Result.Result<string, Failure> {
  return isNonBlankString(value)
    ? Result.succeed(value)
    : Result.fail(onInvalid());
}

export function decodeStableCatalogTableIdInputResult<Failure>(
  value: unknown,
  onInvalid: () => Failure,
): Result.Result<CatalogTableId, Failure> {
  return decodeCatalogTableIdResult(value).pipe(
    Result.mapError(() => onInvalid()),
  );
}
