import { Data, Result } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import type { ApplicationManifestV1 } from "./applicationAnalysisV1";

export const APPLICATION_PUBLICATION_FRAME_VERSION_V1 = 1 as const;
export const APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1 = 1_048_576;

const UTF8 = new TextEncoder();

export class ApplicationPublicationFrameV1Error extends Data.TaggedError(
  "ApplicationPublicationFrameV1Error",
)<{
  readonly operation: "schema" | "functionCatalog" | "functionEntry" |
    "publication";
  readonly reason: "invalidInput" | "bytesExceeded";
}> {}

export interface ApplicationPublicationCommitmentV1Input {
  readonly scopeId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly manifestSha256: string;
  readonly schemaSha256: string;
  readonly functionCatalogSha256: string;
}

/**
 * Canonical Application Publication framing shared by its persistence and
 * runtime-verification owners. Hashing and authority checks stay with callers.
 */
export function applicationSchemaPublicationFrameV1(
  manifest: ApplicationManifestV1,
): Result.Result<Uint8Array, ApplicationPublicationFrameV1Error> {
  return canonicalFrame("schema", {
    format: "flarex.application-schema-publication",
    version: APPLICATION_PUBLICATION_FRAME_VERSION_V1,
    schema: manifest.schema,
  });
}

export function applicationFunctionCatalogPublicationFrameV1(
  manifest: ApplicationManifestV1,
): Result.Result<Uint8Array, ApplicationPublicationFrameV1Error> {
  return canonicalFrame("functionCatalog", {
    format: "flarex.application-function-catalog",
    version: APPLICATION_PUBLICATION_FRAME_VERSION_V1,
    functions: manifest.functions,
  });
}

export function applicationFunctionEntryPublicationFrameV1(
  fn: ApplicationManifestV1["functions"][number],
): Result.Result<Uint8Array, ApplicationPublicationFrameV1Error> {
  return canonicalFrame("functionEntry", fn);
}

export function applicationPublicationCommitmentFrameV1(
  input: ApplicationPublicationCommitmentV1Input,
): Result.Result<Uint8Array, ApplicationPublicationFrameV1Error> {
  return canonicalFrame("publication", {
    format: "flarex.application-publication-commitment",
    version: APPLICATION_PUBLICATION_FRAME_VERSION_V1,
    ...input,
  });
}

function canonicalFrame(
  operation: ApplicationPublicationFrameV1Error["operation"],
  value: unknown,
): Result.Result<Uint8Array, ApplicationPublicationFrameV1Error> {
  if (!isJson(value)) {
    return Result.fail(new ApplicationPublicationFrameV1Error({
      operation,
      reason: "invalidInput",
    }));
  }
  const text = encodeCanonicalJson(value, issue => {
    throw new Error(`Application publication frame invariant: ${issue.reason}`);
  });
  const bytes = UTF8.encode(text);
  return bytes.byteLength > 0 &&
      bytes.byteLength <= APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1
    ? Result.succeed(bytes)
    : Result.fail(new ApplicationPublicationFrameV1Error({
      operation,
      reason: "bytesExceeded",
    }));
}
