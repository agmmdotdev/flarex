import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";
import type {
  DeclarativeV2CandidateFrameV1,
  DeclarativeV2FunctionGroupEntryFrameV1,
  DeclarativeV2RuntimeProjectionFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type { ValidatorJson } from "flarex-protocol/validator-json";

import type {
  ActiveApplicationRevisionMetadataV1,
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "./applicationRevisionActivationV1";
import {
  claimActiveApplicationRevisionRuntimeTargetStateV1,
  InvalidActiveApplicationRevisionSelectionV1Error,
} from "./applicationRevisionActiveSelectionStateV1";
import type {
  LoadedCandidateRuntimePublicationV1,
} from "./candidateRuntimePublicationRepositoryV1";
import {
  decodeCanonicalFunctionMetadataSetV1,
  type FunctionMetadataCodecV1Error,
} from "./functionMetadataCodec";
import {
  hashFunctionMetadataSha256V1,
  type FunctionMetadataSha256V1Error,
} from "./functionMetadataSha256";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";

const FUNCTION_METADATA_BUDGET = Object.freeze({
  maximumFunctionsVisited: 32_768,
  maximumValidatorNodesVisited: 1_048_576,
  maximumCanonicalUtf8BytesMaterialized: 64 * 1_048_576,
});
const HASH_BUDGET = Object.freeze({ maximumInputBytes: 64 * 1_048_576 });

export interface ApplicationRevisionRuntimeTargetFunctionV1 {
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "mutation";
  readonly visibility: "public" | "internal";
  readonly argsValidator: ValidatorJson;
  readonly returnsValidator: ValidatorJson | null;
  readonly entry: DeclarativeV2FunctionGroupEntryFrameV1 & {
    readonly handlerKind: "mutation";
    readonly group: "transaction";
  };
  readonly entryReference:
    LoadedCandidateRuntimePublicationV1["publication"]["functionEntries"][number]["reference"];
  readonly projection: DeclarativeV2RuntimeProjectionFrameV1 & {
    readonly group: "transaction";
  };
}

export interface ApplicationRevisionRuntimeTargetAuthorityV1 {
  readonly metadata: ActiveApplicationRevisionMetadataV1;
  readonly scopeAuthority: TrustedScopeAuthority & Readonly<{
    readonly storageGeneration: "flarexdb_v1";
  }>;
  readonly attemptSha256: Uint8Array;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: Uint8Array;
  readonly candidateFrameBytes: Uint8Array;
  readonly functionMetadataSha256: Uint8Array;
  readonly publication: LoadedCandidateRuntimePublicationV1["publication"];
  readonly function: ApplicationRevisionRuntimeTargetFunctionV1;
}

export class ApplicationRevisionRuntimeTargetV1Error extends Data.TaggedError(
  "ApplicationRevisionRuntimeTargetV1Error",
)<{
  readonly reason:
    | "unknownFunction"
    | "unsupportedFunction"
    | "functionEvidenceMismatch"
    | "candidateEvidenceMismatch";
  readonly functionPath: string;
}> {}

export type ClaimApplicationRevisionRuntimeTargetAuthorityV1Error =
  | InvalidActiveApplicationRevisionSelectionV1Error
  | ApplicationRevisionRuntimeTargetV1Error
  | FunctionMetadataCodecV1Error
  | FunctionMetadataSha256V1Error;

/**
 * Private adapter from the FSV05 process capability to the immutable runtime
 * publication. It owns no database handle and cannot outlive the selection's
 * Scope because the same WeakMap entry is the only source of this authority.
 */
export const claimApplicationRevisionRuntimeTargetAuthorityV1 = Effect.fn(
  "ApplicationRevisionRuntimeTarget.claimAuthorityV1",
)(function* (
  selection: AuthenticatedActiveApplicationRevisionSelectionV1,
  functionPath: string,
): Effect.fn.Return<
  ApplicationRevisionRuntimeTargetAuthorityV1,
  ClaimApplicationRevisionRuntimeTargetAuthorityV1Error
> {
  const active = yield* Effect.fromResult(
    claimActiveApplicationRevisionRuntimeTargetStateV1(selection),
  );
  const runtime = active.runtimeTarget;
  const decoded = yield* Effect.fromResult(
    decodeCanonicalFunctionMetadataSetV1(
      runtime.functionMetadataBytes,
      FUNCTION_METADATA_BUDGET,
    ),
  );
  const functionMetadataSha256 = yield* hashFunctionMetadataSha256V1(
    decoded.canonicalBytes,
    HASH_BUDGET,
  );
  if (
    active.authority.storageGeneration !== "flarexdb_v1" ||
    !bytesEqualFullScan(
      functionMetadataSha256,
      active.metadata.functionMetadataSha256,
    ) ||
    !bytesEqualFullScan(
      runtime.candidateSha256,
      active.metadata.candidateSha256,
    ) ||
    !bytesEqualFullScan(
      runtime.candidate.runtimeProjectionSetSha256,
      active.metadata.runtimeProjectionSetSha256,
    ) ||
    !bytesEqualFullScan(
      runtime.candidate.functionGroupManifestSha256,
      active.metadata.functionGroupManifestSha256,
    )
  ) {
    return yield* new ApplicationRevisionRuntimeTargetV1Error({
      reason: "candidateEvidenceMismatch",
      functionPath,
    });
  }
  const metadata = decoded.functions.find(
    item => item.metadata.functionPath === functionPath,
  );
  const entryAuthority = runtime.publication.functionEntries.find(
    item => item.frame.functionPath === functionPath,
  );
  if (metadata === undefined || entryAuthority === undefined) {
    return yield* new ApplicationRevisionRuntimeTargetV1Error({
      reason: "unknownFunction",
      functionPath,
    });
  }
  if (
    metadata.metadata.kind !== "mutation" ||
    entryAuthority.frame.handlerKind !== "mutation" ||
    entryAuthority.frame.group !== "transaction"
  ) {
    return yield* new ApplicationRevisionRuntimeTargetV1Error({
      reason: "unsupportedFunction",
      functionPath,
    });
  }
  const projectionAuthority = runtime.publication.projections.find(
    item => item.frame.group === "transaction",
  );
  const separator = functionPath.lastIndexOf(":");
  if (
    projectionAuthority === undefined || separator <= 0 ||
    entryAuthority.frame.functionOrdinal !== BigInt(metadata.ordinal) ||
    entryAuthority.frame.exportName !== functionPath.slice(separator + 1) ||
    metadata.metadata.visibility !== entryAuthority.frame.visibility ||
    !bytesEqualFullScan(
      entryAuthority.frame.projectionSha256,
      projectionAuthority.reference.sha256,
    ) ||
    !projectionAuthority.modules.some(
      module => module.modulePath === entryAuthority.frame.executionModule,
    )
  ) {
    return yield* new ApplicationRevisionRuntimeTargetV1Error({
      reason: "functionEvidenceMismatch",
      functionPath,
    });
  }
  return Object.freeze({
    metadata: active.metadata,
    scopeAuthority: Object.freeze({
      ...active.authority,
      storageGeneration: active.authority.storageGeneration,
    }),
    attemptSha256: copyBytes(runtime.attemptSha256),
    candidate: runtime.candidate,
    candidateSha256: copyBytes(runtime.candidateSha256),
    candidateFrameBytes: copyBytes(runtime.candidateFrameBytes),
    functionMetadataSha256: copyBytes(functionMetadataSha256),
    publication: runtime.publication,
    function: Object.freeze({
      functionOrdinal: BigInt(metadata.ordinal),
      functionPath,
      logicalExecutionModule: metadata.metadata.executionModule,
      artifactExecutionModule: entryAuthority.frame.executionModule,
      exportName: entryAuthority.frame.exportName,
      handlerKind: "mutation" as const,
      visibility: entryAuthority.frame.visibility,
      argsValidator: metadata.metadata.argsValidator,
      returnsValidator: metadata.metadata.returnsValidator,
      entry: entryAuthority.frame as typeof entryAuthority.frame & {
        readonly handlerKind: "mutation";
        readonly group: "transaction";
      },
      entryReference: entryAuthority.reference,
      projection: projectionAuthority.frame as typeof projectionAuthority.frame & {
        readonly group: "transaction";
      },
    }),
  });
});
