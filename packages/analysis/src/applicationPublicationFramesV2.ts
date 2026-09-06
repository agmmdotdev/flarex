import { Data, Result } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import {
  APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1,
  applicationSchemaPublicationFrameV1,
  type ApplicationPublicationFrameV1Error,
} from "./applicationPublicationFramesV1";
import {
  type ApplicationManifest,
  type ApplicationManifestV2,
  isApplicationManifestV1,
} from "./applicationAnalysisV2";
import { applicationSchemaPublicationFrameV3, applicationPublicationCommitmentFrameV3, type ApplicationPublicationFrameV3Error } from "./applicationPublicationFramesV3.ts";

export const APPLICATION_SCHEMA_PUBLICATION_FRAME_VERSION_V2 = 2 as const;
export const APPLICATION_SCHEMA_PUBLICATION_MAXIMUM_FRAME_BYTES_V2 =
  APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1;
export const APPLICATION_PUBLICATION_FRAME_VERSION_V2 = 2 as const;
export const APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V2 =
  APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1;

const UTF8 = new TextEncoder();

export class ApplicationSchemaPublicationFrameV2Error extends Data.TaggedError(
  "ApplicationSchemaPublicationFrameV2Error",
)<{
  readonly operation: "schema";
  readonly reason: "invalidInput" | "bytesExceeded";
}> {}

export class ApplicationPublicationFrameV2Error extends Data.TaggedError(
  "ApplicationPublicationFrameV2Error",
)<{
  readonly operation: "functionCatalog" | "functionEntry" | "publication";
  readonly reason: "invalidInput" | "bytesExceeded";
}> {}

export interface ApplicationPublicationCommitmentV2Input {
  readonly scopeId: string;
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly manifestSha256: string;
  readonly schemaSha256: string;
  readonly functionCatalogSha256: string;
  readonly schemaVersionId: string;
  readonly schemaManifestSha256: string;
  readonly manifestSchemaBindingSha256: string;
  readonly boundPublicationSha256: string;
}

/** Canonical schema-only frame for the exact Application Manifest V2 schema. */
export function applicationSchemaPublicationFrameV2(
  manifest: ApplicationManifestV2,
): Result.Result<Uint8Array, ApplicationSchemaPublicationFrameV2Error> {
  const frame = {
    format: "flarex.application-schema-publication",
    version: APPLICATION_SCHEMA_PUBLICATION_FRAME_VERSION_V2,
    schema: manifest.schema,
  };
  if (!isJson(frame)) {
    return Result.fail(new ApplicationSchemaPublicationFrameV2Error({
      operation: "schema",
      reason: "invalidInput",
    }));
  }
  const text = encodeCanonicalJson(frame, issue => {
    throw new Error(
      `Application schema publication V2 invariant: ${issue.reason}`,
    );
  });
  const bytes = UTF8.encode(text);
  return bytes.byteLength > 0 &&
      bytes.byteLength <= APPLICATION_SCHEMA_PUBLICATION_MAXIMUM_FRAME_BYTES_V2
    ? Result.succeed(bytes)
    : Result.fail(new ApplicationSchemaPublicationFrameV2Error({
      operation: "schema",
      reason: "bytesExceeded",
    }));
}

/** Canonical function catalog for a relation-bearing Application manifest. */
export function applicationFunctionCatalogPublicationFrameV2(
  manifest: Pick<ApplicationManifestV2, "functions">,
): Result.Result<Uint8Array, ApplicationPublicationFrameV2Error> {
  return canonicalPublicationFrame("functionCatalog", {
    format: "flarex.application-function-catalog",
    version: APPLICATION_PUBLICATION_FRAME_VERSION_V2,
    functions: manifest.functions,
  });
}

/** Canonical function entry retained independently from the catalog root. */
export function applicationFunctionEntryPublicationFrameV2(
  fn: ApplicationManifestV2["functions"][number],
): Result.Result<Uint8Array, ApplicationPublicationFrameV2Error> {
  return canonicalPublicationFrame("functionEntry", fn);
}

/**
 * Canonical relation-aware publication commitment. R02 schema identity is
 * part of the commitment rather than a later caller-authored association.
 */
export function applicationPublicationCommitmentFrameV2(
  input: ApplicationPublicationCommitmentV2Input,
): Result.Result<Uint8Array, ApplicationPublicationFrameV2Error> {
  return canonicalPublicationFrame("publication", {
    format: "flarex.application-publication-commitment",
    version: APPLICATION_PUBLICATION_FRAME_VERSION_V2,
    ...input,
  });
}

export function applicationSchemaPublicationFrame(
  manifest: ApplicationManifest,
): Result.Result<
  Uint8Array,
  ApplicationPublicationFrameV1Error |
    ApplicationSchemaPublicationFrameV2Error | ApplicationPublicationFrameV3Error
> {
  if (manifest.version === 3) return applicationSchemaPublicationFrameV3(manifest);
  return isApplicationManifestV1(manifest)
    ? applicationSchemaPublicationFrameV1(manifest)
    : applicationSchemaPublicationFrameV2(manifest);
}

export function applicationPublicationCommitmentFrame(
  manifest: ApplicationManifestV2 | import("./applicationAnalysisV3.ts").ApplicationManifestV3,
  input: ApplicationPublicationCommitmentV2Input,
): Result.Result<Uint8Array, ApplicationPublicationFrameV2Error | ApplicationPublicationFrameV3Error> {
  return manifest.version === 3
    ? applicationPublicationCommitmentFrameV3({ ...input, writePolicySetSha256: manifest.schema.writePolicySetSha256 })
    : applicationPublicationCommitmentFrameV2(input);
}

function canonicalPublicationFrame(
  operation: ApplicationPublicationFrameV2Error["operation"],
  value: unknown,
): Result.Result<Uint8Array, ApplicationPublicationFrameV2Error> {
  if (!isJson(value)) {
    return Result.fail(new ApplicationPublicationFrameV2Error({
      operation,
      reason: "invalidInput",
    }));
  }
  const text = encodeCanonicalJson(value, issue => {
    throw new Error(
      `Application publication V2 invariant: ${issue.reason}`,
    );
  });
  const bytes = UTF8.encode(text);
  return bytes.byteLength > 0 &&
      bytes.byteLength <= APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V2
    ? Result.succeed(bytes)
    : Result.fail(new ApplicationPublicationFrameV2Error({
      operation,
      reason: "bytesExceeded",
    }));
}
