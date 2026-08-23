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

export const APPLICATION_SCHEMA_PUBLICATION_FRAME_VERSION_V2 = 2 as const;
export const APPLICATION_SCHEMA_PUBLICATION_MAXIMUM_FRAME_BYTES_V2 =
  APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1;

const UTF8 = new TextEncoder();

export class ApplicationSchemaPublicationFrameV2Error extends Data.TaggedError(
  "ApplicationSchemaPublicationFrameV2Error",
)<{
  readonly operation: "schema";
  readonly reason: "invalidInput" | "bytesExceeded";
}> {}

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

export function applicationSchemaPublicationFrame(
  manifest: ApplicationManifest,
): Result.Result<
  Uint8Array,
  ApplicationPublicationFrameV1Error |
    ApplicationSchemaPublicationFrameV2Error
> {
  return isApplicationManifestV1(manifest)
    ? applicationSchemaPublicationFrameV1(manifest)
    : applicationSchemaPublicationFrameV2(manifest);
}
