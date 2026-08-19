import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Result, Schema } from "effect";

import {
  CatalogTableIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema,
  CatalogUniqueConstraintIdSchema,
  type CatalogTableId,
  type CatalogUniqueConstraintDefinitionId,
  type CatalogUniqueConstraintId,
} from "./catalog";
import {
  AppUniqueConstraintSpecSha256HexV1Schema,
  type AppUniqueConstraintSpecSha256HexV1,
} from "./app-unique-constraint-definition";
import { StrictParseOptions, StrictStructOptions } from
  "./strict-schema-options";
import {
  CanonicalPositivePostgresBigIntFromString,
  POSTGRES_SIGNED_BIGINT_MAX,
} from "./postgres-bigint";

export const MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1 = 256;
export const MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SET_BYTES_V1 = 131_072;

export const AppUniqueConstraintSetCodecVersionV1Schema = Schema.Literal(1)
  .pipe(Schema.brand("FlarexDB/AppUniqueConstraintSetCodecVersionV1"));
export type AppUniqueConstraintSetCodecVersionV1 =
  typeof AppUniqueConstraintSetCodecVersionV1Schema.Type;
export const APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1 =
  AppUniqueConstraintSetCodecVersionV1Schema.make(1);

export const AppUniqueConstraintSetBuildLifecycleV1Schema = Schema.Literals([
  "declared",
  "building",
  "backfilling",
  "validating",
  "enabled",
]);
export type AppUniqueConstraintSetBuildLifecycleV1 =
  typeof AppUniqueConstraintSetBuildLifecycleV1Schema.Type;

export const AppUniqueConstraintSetBuildCursorCodecVersionV1Schema =
  Schema.Literal(1).pipe(
    Schema.brand("FlarexDB/AppUniqueConstraintSetBuildCursorCodecVersionV1"),
  );
export type AppUniqueConstraintSetBuildCursorCodecVersionV1 =
  typeof AppUniqueConstraintSetBuildCursorCodecVersionV1Schema.Type;
export const APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1 =
  AppUniqueConstraintSetBuildCursorCodecVersionV1Schema.make(1);

export const MAX_APP_UNIQUE_CONSTRAINT_SET_BUILD_ATTEMPT_FENCE_V1 =
  POSTGRES_SIGNED_BIGINT_MAX;
export const AppUniqueConstraintSetBuildAttemptFenceV1Schema =
  CanonicalPositivePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/AppUniqueConstraintSetBuildAttemptFenceV1"),
  );
export type AppUniqueConstraintSetBuildAttemptFenceV1 =
  typeof AppUniqueConstraintSetBuildAttemptFenceV1Schema.Type;

export const AppUniqueConstraintSetMemberV1Schema = Schema.Struct({
  logicalUniqueConstraintId: CatalogUniqueConstraintIdSchema,
  uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema,
  tableId: CatalogTableIdSchema,
  physicalSpecSha256Hex: AppUniqueConstraintSpecSha256HexV1Schema,
}).annotate(StrictStructOptions);
export interface AppUniqueConstraintSetMemberV1 {
  readonly logicalUniqueConstraintId: CatalogUniqueConstraintId;
  readonly uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionId;
  readonly tableId: CatalogTableId;
  readonly physicalSpecSha256Hex: AppUniqueConstraintSpecSha256HexV1;
}

const AppUniqueConstraintSetMembersV1Schema = Schema.Array(
  AppUniqueConstraintSetMemberV1Schema,
).check(
  Schema.isMaxLength(MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1),
  Schema.makeFilter((members) => {
    const logicalIds = new Set<number>();
    const definitionIds = new Set<number>();
    for (const member of members) {
      if (logicalIds.has(member.logicalUniqueConstraintId)) {
        return "Expected unique logical constraint IDs";
      }
      if (definitionIds.has(member.uniqueConstraintDefinitionId)) {
        return "Expected unique physical definition IDs";
      }
      logicalIds.add(member.logicalUniqueConstraintId);
      definitionIds.add(member.uniqueConstraintDefinitionId);
    }
    return undefined;
  }),
);

const decodeMembersResult = Schema.decodeUnknownResult(
  AppUniqueConstraintSetMembersV1Schema,
  StrictParseOptions,
);

export const CanonicalAppUniqueConstraintSetBytesHexV1Schema = Schema.String
  .check(Schema.makeFilter((value) => {
    if (value.length > MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SET_BYTES_V1 * 2) {
      return `Expected at most ${MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SET_BYTES_V1} canonical set bytes`;
    }
    return /^(?:[0-9a-f]{2})+$/.test(value)
      ? undefined
      : "Expected nonempty canonical lowercase hexadecimal bytes";
  }))
  .pipe(Schema.brand("FlarexDB/CanonicalAppUniqueConstraintSetBytesHexV1"));
export type CanonicalAppUniqueConstraintSetBytesHexV1 =
  typeof CanonicalAppUniqueConstraintSetBytesHexV1Schema.Type;

export const AppUniqueConstraintSetSha256HexV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{64}$/.test(value)
      ? undefined
      : "Expected an exact lowercase hexadecimal SHA-256 digest"
  ),
).pipe(Schema.brand("FlarexDB/AppUniqueConstraintSetSha256HexV1"));
export type AppUniqueConstraintSetSha256HexV1 =
  typeof AppUniqueConstraintSetSha256HexV1Schema.Type;

const decodeCanonicalBytesHexResult = Schema.decodeUnknownResult(
  CanonicalAppUniqueConstraintSetBytesHexV1Schema,
);
const decodeSha256HexResult = Schema.decodeUnknownResult(
  AppUniqueConstraintSetSha256HexV1Schema,
);

export interface CanonicalAppUniqueConstraintSetV1 {
  readonly codecVersion: AppUniqueConstraintSetCodecVersionV1;
  readonly members: ReadonlyArray<AppUniqueConstraintSetMemberV1>;
  readonly memberCount: number;
  readonly canonicalText: string;
  readonly canonicalBytesHex: CanonicalAppUniqueConstraintSetBytesHexV1;
  readonly sha256Hex: AppUniqueConstraintSetSha256HexV1;
}

/** Canonical target-native commitment to one schema version's complete set. */
export async function canonicalizeAppUniqueConstraintSetV1(
  value: unknown,
): Promise<CanonicalAppUniqueConstraintSetV1> {
  const decoded = Result.getOrThrow(decodeMembersResult(value));
  const members = Array.from(decoded, snapshotMember).toSorted(compareMembers);
  const canonicalText =
    `{"format":"flarexdb-app-unique-constraint-set",` +
    `"members":[${members.map(encodeMember).join(",")}],` +
    `"setCodecVersion":1}`;
  const bytes = new TextEncoder().encode(canonicalText);
  if (bytes.byteLength > MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SET_BYTES_V1) {
    throw new RangeError("Canonical unique-constraint set exceeds its byte limit.");
  }
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput),
  );
  return Object.freeze({
    codecVersion: APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1,
    members: Object.freeze(members),
    memberCount: members.length,
    canonicalText,
    canonicalBytesHex: Result.getOrThrow(
      decodeCanonicalBytesHexResult(encodeBytesToLowercaseHex(bytes)),
    ),
    sha256Hex: Result.getOrThrow(
      decodeSha256HexResult(encodeBytesToLowercaseHex(digest)),
    ),
  });
}

export function appUniqueConstraintSetSha256HexV1ToBytes(
  value: AppUniqueConstraintSetSha256HexV1,
): Uint8Array {
  return hexToBytes(Result.getOrThrow(decodeSha256HexResult(value)));
}

function snapshotMember(
  member: AppUniqueConstraintSetMemberV1,
): AppUniqueConstraintSetMemberV1 {
  return Object.freeze({
    logicalUniqueConstraintId: member.logicalUniqueConstraintId,
    uniqueConstraintDefinitionId: member.uniqueConstraintDefinitionId,
    tableId: member.tableId,
    physicalSpecSha256Hex: member.physicalSpecSha256Hex,
  });
}

function compareMembers(
  left: AppUniqueConstraintSetMemberV1,
  right: AppUniqueConstraintSetMemberV1,
): number {
  return left.uniqueConstraintDefinitionId - right.uniqueConstraintDefinitionId;
}

function encodeMember(member: AppUniqueConstraintSetMemberV1): string {
  return (
    `{"logicalUniqueConstraintId":${member.logicalUniqueConstraintId},` +
    `"physicalSpecSha256Hex":"${member.physicalSpecSha256Hex}",` +
    `"tableId":${member.tableId},` +
    `"uniqueConstraintDefinitionId":${member.uniqueConstraintDefinitionId}}`
  );
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}
