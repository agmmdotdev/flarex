/** Private framework adapter value contract; grants no installation or storage access. */
export { normalizeRelationalSchema } from "./relationalSchema/policy";
export { captureRelationalSchemaArtifact } from "./relationalSchema/artifact";
export type { RelationalSchema, CapturedRelationalSchemaArtifact } from "./relationalSchema/model";
export type { RelationalSchemaError } from "./relationalSchema/errors";
export type { FrameworkSchemaArtifactError } from "./frameworkSchema/artifact/errors";
