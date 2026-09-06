import { Data, Result } from "effect";
import { encodeCanonicalJson, isJson, measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import { APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1 } from "./applicationPublicationFramesV1.ts";
import type { ApplicationManifestV3 } from "./applicationAnalysisV3.ts";
import type { ApplicationPublicationCommitmentV2Input } from "./applicationPublicationFramesV2.ts";

export class ApplicationPublicationFrameV3Error extends Data.TaggedError("ApplicationPublicationFrameV3Error")<{
  readonly reason: "invalidInput" | "bytesExceeded";
}> {}

/** V3 schema identity includes the complete configuration and write-policy evidence. */
export function applicationSchemaPublicationFrameV3(
  manifest: ApplicationManifestV3,
): Result.Result<Uint8Array, ApplicationPublicationFrameV3Error> {
  return canonicalFrame({
    format: "flarex.application-schema-publication",
    version: 3,
    schema: manifest.schema,
  });
}

export function applicationPublicationCommitmentFrameV3(
  input: ApplicationPublicationCommitmentV2Input & { readonly writePolicySetSha256: string },
): Result.Result<Uint8Array, ApplicationPublicationFrameV3Error> {
  return canonicalFrame({
    format: "flarex.application-publication-commitment",
    version: 3,
    ...input,
  });
}

function canonicalFrame(frame: unknown): Result.Result<Uint8Array, ApplicationPublicationFrameV3Error> {
  if (!isJson(frame)) return Result.fail(new ApplicationPublicationFrameV3Error({ reason: "invalidInput" }));
  const measured = measureCanonicalJsonUtf8Bytes(frame, APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1);
  if (measured.kind !== "success") return Result.fail(new ApplicationPublicationFrameV3Error({ reason: "bytesExceeded" }));
  return Result.succeed(new TextEncoder().encode(encodeCanonicalJson(frame, issue => {
    throw new Error(`Application V3 schema publication lost JSON: ${issue.reason}`);
  })));
}
