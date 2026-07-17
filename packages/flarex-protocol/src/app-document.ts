import { Data, Schema } from "effect";

import type { CatalogTableId } from "./catalog";
import {
  appDocumentIdV1FromRowIdentity,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "./app-document-id";
import {
  canonicalizeFlarexValueV1,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
  verifyFlarexValueEvidenceV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
  type VerifyFlarexValueEvidenceV1Input,
} from "./value";

export const AppCreationTimeV1Schema = Schema.Number.check(
  Schema.makeFilter((value) =>
    Number.isFinite(value) && value > 0 && value < 2 ** 53
      ? undefined
      : "Expected a positive finite float64 below 2^53",
  ),
).pipe(Schema.brand("FlarexDB/AppCreationTimeV1"));
export type AppCreationTimeV1 = typeof AppCreationTimeV1Schema.Type;
export const decodeAppCreationTimeV1 = Schema.decodeUnknownSync(
  AppCreationTimeV1Schema,
);

export type AppDocumentSystemFieldV1 = "_id" | "_creationTime";

export type AppDocumentSystemFieldV1Issue =
  | {
      readonly reason: "developerAuthoredSystemField";
      readonly field: AppDocumentSystemFieldV1;
    }
  | {
      readonly reason: "identityMismatch";
      readonly expected: AppDocumentIdV1;
      readonly actual: unknown;
    }
  | {
      readonly reason: "creationTimeMismatch";
      readonly expected: AppCreationTimeV1;
      readonly actual: unknown;
    };

export class AppDocumentSystemFieldV1Error extends Data.TaggedError(
  "AppDocumentSystemFieldV1Error",
)<{
  readonly issue: AppDocumentSystemFieldV1Issue;
}> {}

export interface CanonicalizeAppDocumentV1Input {
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly creationTime: AppCreationTimeV1;
  readonly fields: unknown;
}

export interface VerifyAppDocumentEvidenceV1Input
  extends Omit<VerifyFlarexValueEvidenceV1Input, "profile"> {
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly creationTime: AppCreationTimeV1;
}

export async function canonicalizeAppDocumentV1(
  input: CanonicalizeAppDocumentV1Input,
): Promise<CanonicalFlarexValueV1> {
  const creationTime = decodeAppCreationTimeV1(input.creationTime);
  const normalized = normalizeFlarexValueV1(input.fields, "appDocument");
  const fields = requireCanonicalDocumentObject(normalized.value);
  assertDeveloperDidNotAuthorSystemFields(fields);
  const id = appDocumentIdV1FromRowIdentity({
    tableId: input.tableId,
    rowId: input.rowId,
  });
  return canonicalizeFlarexValueV1(
    { ...fields, _id: id, _creationTime: creationTime },
    "appDocument",
  );
}

export async function verifyAppDocumentEvidenceV1(
  input: VerifyAppDocumentEvidenceV1Input,
): Promise<CanonicalFlarexValueV1> {
  const creationTime = decodeAppCreationTimeV1(input.creationTime);
  const expectedId = appDocumentIdV1FromRowIdentity({
    tableId: input.tableId,
    rowId: input.rowId,
  });
  const verified = await verifyFlarexValueEvidenceV1({
    codecVersion: input.codecVersion,
    valueJson: input.valueJson,
    sha256: input.sha256,
    ...(input.canonicalBytes === undefined
      ? {}
      : { canonicalBytes: input.canonicalBytes }),
    profile: "appDocument",
  });
  const document = requireCanonicalDocumentObject(verified.value);
  if (document._id !== expectedId) {
    throw new AppDocumentSystemFieldV1Error({
      issue: {
        reason: "identityMismatch",
        expected: expectedId,
        actual: document._id,
      },
    });
  }
  if (document._creationTime !== creationTime) {
    throw new AppDocumentSystemFieldV1Error({
      issue: {
        reason: "creationTimeMismatch",
        expected: creationTime,
        actual: document._creationTime,
      },
    });
  }
  return verified;
}

function assertDeveloperDidNotAuthorSystemFields(
  fields: CanonicalFlarexRuntimeObjectV1,
): void {
  for (const field of ["_id", "_creationTime"] as const) {
    if (Object.hasOwn(fields, field)) {
      throw new AppDocumentSystemFieldV1Error({
        issue: { reason: "developerAuthoredSystemField", field },
      });
    }
  }
}

function requireCanonicalDocumentObject(
  value: CanonicalFlarexRuntimeValueV1,
): CanonicalFlarexRuntimeObjectV1 {
  if (!isCanonicalFlarexRuntimeObjectV1(value)) {
    throw new Error("Value Codec V1 app-document profile returned a non-object.");
  }
  return value;
}
