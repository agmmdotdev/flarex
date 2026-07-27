import type { Brand } from "effect";

export const SOURCE_ARTIFACT_V2_CODEC_VERSION = 1;

export const SOURCE_ARTIFACT_V2_ROLE_BITS_V1 = Object.freeze({
  function: 1,
  schema: 2,
  auth: 4,
  execution: 8,
} as const);

export type SourceArtifactV2ModuleRoleV1 =
  keyof typeof SOURCE_ARTIFACT_V2_ROLE_BITS_V1;

export type SourceArtifactV2ModuleRolesV1 = Brand.Branded<
  number,
  "Flarex/SourceArtifactV2ModuleRolesV1"
>;

export const SOURCE_ARTIFACT_V2_ROLE_FUNCTION =
  SOURCE_ARTIFACT_V2_ROLE_BITS_V1.function;
export const SOURCE_ARTIFACT_V2_ROLE_SCHEMA =
  SOURCE_ARTIFACT_V2_ROLE_BITS_V1.schema;
export const SOURCE_ARTIFACT_V2_ROLE_AUTH =
  SOURCE_ARTIFACT_V2_ROLE_BITS_V1.auth;
export const SOURCE_ARTIFACT_V2_ROLE_EXECUTION =
  SOURCE_ARTIFACT_V2_ROLE_BITS_V1.execution;
export const SOURCE_ARTIFACT_V2_ROLE_MASK =
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION |
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA |
  SOURCE_ARTIFACT_V2_ROLE_AUTH |
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION;

export function isSourceArtifactV2ModuleRolesV1(
  value: unknown,
): value is SourceArtifactV2ModuleRolesV1 {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= SOURCE_ARTIFACT_V2_ROLE_MASK &&
    (value & ~SOURCE_ARTIFACT_V2_ROLE_MASK) === 0;
}
