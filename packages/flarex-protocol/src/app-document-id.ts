import {
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data, Result, Schema } from "effect";

import {
  CatalogTableIdSchema,
  decodeCatalogTableId,
  type CatalogTableId,
} from "./catalog";
import {
  canonicalUuidTextV1FromHex,
  canonicalUuidTextV1ToHex,
  isCanonicalUuidTextV1,
} from "./canonical-uuid";

export const APP_ROW_ID_BYTES_V1 = 16;

export const AppRowIdHexV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{32}$/.test(value)
      ? undefined
      : "Expected one canonical lowercase 16-byte row identity",
  ),
).pipe(Schema.brand("FlarexDB/AppRowIdHexV1"));
export type AppRowIdHexV1 = typeof AppRowIdHexV1Schema.Type;
export const decodeAppRowIdHexV1 = Schema.decodeUnknownSync(
  AppRowIdHexV1Schema,
);

export const AppDocumentIdV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    Result.isFailure(decodeAppDocumentIdPartsV1Result(value))
      ? "Expected <positive table ID>:<canonical lowercase UUID>"
      : undefined,
  ),
).pipe(Schema.brand("FlarexDB/AppDocumentIdV1"));
export type AppDocumentIdV1 = typeof AppDocumentIdV1Schema.Type;
export const decodeAppDocumentIdV1 = Schema.decodeUnknownSync(
  AppDocumentIdV1Schema,
);
const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);

export interface AppDocumentIdentityV1 {
  readonly id: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

export type AppDocumentIdV1Issue =
  | { readonly reason: "invalidType"; readonly value: unknown }
  | { readonly reason: "invalidFormat"; readonly value: string }
  | { readonly reason: "invalidTableId"; readonly value: string }
  | { readonly reason: "invalidRowId"; readonly value: unknown }
  | {
      readonly reason: "tableMismatch";
      readonly expectedTableId: CatalogTableId;
      readonly actualTableId: CatalogTableId;
    };

export class AppDocumentIdV1Error extends Data.TaggedError(
  "AppDocumentIdV1Error",
)<{
  readonly issue: AppDocumentIdV1Issue;
}> {}

export function decodeAppDocumentIdentityV1(
  value: unknown,
): AppDocumentIdentityV1 {
  return Result.getOrThrow(decodeAppDocumentIdentityV1Result(value));
}

export function decodeAppDocumentIdentityV1Result(
  value: unknown,
): Result.Result<AppDocumentIdentityV1, AppDocumentIdV1Error> {
  return decodeAppDocumentIdPartsV1Result(value).pipe(Result.map((parts) =>
    Object.freeze({
      id: AppDocumentIdV1Schema.make(parts.id),
      tableId: parts.tableId,
      rowId: decodeAppRowIdHexV1(canonicalUuidTextV1ToHex(parts.uuid)),
    } satisfies AppDocumentIdentityV1)
  ));
}

interface AppDocumentIdPartsV1 {
  readonly id: string;
  readonly tableId: CatalogTableId;
  readonly uuid: string;
}

function decodeAppDocumentIdPartsV1Result(
  value: unknown,
): Result.Result<AppDocumentIdPartsV1, AppDocumentIdV1Error> {
  if (typeof value !== "string") {
    return Result.fail(new AppDocumentIdV1Error({
      issue: { reason: "invalidType", value },
    }));
  }
  const separator = value.indexOf(":");
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf(":") ||
    separator === value.length - 1
  ) {
    return Result.fail(new AppDocumentIdV1Error({
      issue: { reason: "invalidFormat", value },
    }));
  }

  const tableText = value.slice(0, separator);
  if (!/^[1-9][0-9]*$/.test(tableText)) {
    return Result.fail(new AppDocumentIdV1Error({
      issue: { reason: "invalidTableId", value: tableText },
    }));
  }
  const tableNumber = Number(tableText);
  if (!isPositiveSafeInteger(tableNumber)) {
    return Result.fail(new AppDocumentIdV1Error({
      issue: { reason: "invalidTableId", value: tableText },
    }));
  }
  const tableIdResult = decodeCatalogTableIdResult(tableNumber);
  if (Result.isFailure(tableIdResult)) {
    return Result.fail(new AppDocumentIdV1Error({
      issue: { reason: "invalidTableId", value: tableText },
    }));
  }
  const tableId = tableIdResult.success;

  const uuid = value.slice(separator + 1);
  if (!isCanonicalUuidTextV1(uuid)) {
    return Result.fail(new AppDocumentIdV1Error({
      issue: { reason: "invalidRowId", value: uuid },
    }));
  }
  return Result.succeed(Object.freeze({
    id: value,
    tableId,
    uuid,
  } satisfies AppDocumentIdPartsV1));
}

export function appDocumentIdV1FromRowIdentity(input: {
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}): AppDocumentIdV1 {
  const tableId = decodeCatalogTableId(input.tableId);
  const rowId = decodeAppRowIdHexV1(input.rowId);
  const uuid = canonicalUuidTextV1FromHex(rowId);
  return decodeAppDocumentIdV1(`${tableId}:${uuid}`);
}

export function requireAppDocumentIdentityV1ForTable(
  value: unknown,
  expectedTableId: CatalogTableId,
): AppDocumentIdentityV1 {
  return Result.getOrThrow(
    requireAppDocumentIdentityV1ForTableResult(value, expectedTableId),
  );
}

export function requireAppDocumentIdentityV1ForTableResult(
  value: unknown,
  expectedTableId: CatalogTableId,
): Result.Result<AppDocumentIdentityV1, AppDocumentIdV1Error> {
  const expected = decodeCatalogTableId(expectedTableId);
  return Result.gen(function* () {
    const identity = yield* decodeAppDocumentIdentityV1Result(value);
    if (identity.tableId === expected) return identity;
    return yield* Result.fail(new AppDocumentIdV1Error({
      issue: {
        reason: "tableMismatch",
        expectedTableId: expected,
        actualTableId: identity.tableId,
      },
    }));
  });
}

export function appRowIdHexV1FromBytes(value: unknown): AppRowIdHexV1 {
  return Result.getOrThrow(appRowIdHexV1FromBytesResult(value));
}

export function appRowIdHexV1FromBytesResult(
  value: unknown,
): Result.Result<AppRowIdHexV1, AppDocumentIdV1Error> {
  if (!isUint8ArrayWithByteLength(value, APP_ROW_ID_BYTES_V1)) {
    return Result.fail(new AppDocumentIdV1Error({
      issue: {
        reason: "invalidRowId",
        value,
      },
    }));
  }
  return Result.succeed(
    AppRowIdHexV1Schema.make(encodeBytesToLowercaseHex(value)),
  );
}

export function appRowIdHexV1ToBytes(value: AppRowIdHexV1): Uint8Array {
  const hex = decodeAppRowIdHexV1(value);
  const bytes = new Uint8Array(APP_ROW_ID_BYTES_V1);
  for (let index = 0; index < APP_ROW_ID_BYTES_V1; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
