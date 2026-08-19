import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";
import type {
  DeclarativeV2CandidateFrameV1,
  DeclarativeV2FunctionGroupEntryFrameV1,
  DeclarativeV2RuntimeProjectionFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

import type {
  AuthenticatedActiveApplicationRevisionSelectionV1,
  ActiveApplicationRevisionMetadataV1,
} from "./applicationRevisionActivationV1";
import {
  claimActiveApplicationRevisionRuntimeTargetStateV1,
  InvalidActiveApplicationRevisionSelectionV1Error,
} from "./applicationRevisionActiveSelectionStateV1";
import type { LoadedCandidateRuntimePublicationV1 } from
  "./candidateRuntimePublicationRepositoryV1";
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

export interface ApplicationRevisionMutationInternalQueryRuntimeTargetFunctionV1 {
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "mutation";
  readonly visibility: "public";
  readonly argsValidator:
    | ObjectValidatorJsonV1
    | Readonly<{ readonly type: "any" }>;
  readonly returnsValidator: ValidatorJsonV1 | null;
  readonly entry: DeclarativeV2FunctionGroupEntryFrameV1 & {
    readonly handlerKind: "mutation";
    readonly visibility: "public";
    readonly group: "transaction";
  };
  readonly entryReference:
    LoadedCandidateRuntimePublicationV1["publication"]["functionEntries"][number]["reference"];
  readonly projection: DeclarativeV2RuntimeProjectionFrameV1 & {
    readonly group: "transaction";
  };
}

export interface ApplicationRevisionMutationInternalQueryRuntimeTargetCatalogEntryV1 {
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "query";
  readonly visibility: "internal";
  readonly argsValidator:
    | ObjectValidatorJsonV1
    | Readonly<{ readonly type: "any" }>;
  readonly returnsValidator: ValidatorJsonV1 | null;
  readonly entry: DeclarativeV2FunctionGroupEntryFrameV1 & {
    readonly handlerKind: "query";
    readonly visibility: "internal";
    readonly group: "transaction";
  };
  readonly entryReference:
    LoadedCandidateRuntimePublicationV1["publication"]["functionEntries"][number]["reference"];
}

export interface ApplicationRevisionMutationInternalQueryRuntimeTargetAuthorityV1 {
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
  readonly function: ApplicationRevisionMutationInternalQueryRuntimeTargetFunctionV1;
  readonly internalQueryCatalog: ReadonlyArray<
    ApplicationRevisionMutationInternalQueryRuntimeTargetCatalogEntryV1
  >;
}

export class ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error
  extends Data.TaggedError("ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error")<{
    readonly reason:
      | "unknownFunction"
      | "unsupportedFunction"
      | "functionEvidenceMismatch"
      | "candidateEvidenceMismatch";
    readonly functionPath: string;
  }> {}

export type ClaimApplicationRevisionMutationInternalQueryRuntimeTargetAuthorityV1Error =
  | InvalidActiveApplicationRevisionSelectionV1Error
  | ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error
  | FunctionMetadataCodecV1Error
  | FunctionMetadataSha256V1Error;

function isPointQueryArgsValidatorV1(
  input: ValidatorJsonV1,
): input is ObjectValidatorJsonV1 | Readonly<{ readonly type: "any" }> {
  return input.type === "any" || input.type === "object";
}

const isPointMutationArgsValidatorV1 = isPointQueryArgsValidatorV1;

/**
 * Joins the live active-selection authority to immutable mutation and internal
 * query publication evidence without exposing persistence state.
 */
export const claimApplicationRevisionMutationInternalQueryRuntimeTargetAuthorityV1 = Effect.fn(
  "ApplicationRevisionMutationInternalQueryRuntimeTarget.claimAuthorityV1",
)(function* (
  selection: AuthenticatedActiveApplicationRevisionSelectionV1,
  functionPath: string,
): Effect.fn.Return<
  ApplicationRevisionMutationInternalQueryRuntimeTargetAuthorityV1,
  ClaimApplicationRevisionMutationInternalQueryRuntimeTargetAuthorityV1Error
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
    !bytesEqualFullScan(functionMetadataSha256, active.metadata.functionMetadataSha256) ||
    !bytesEqualFullScan(runtime.candidateSha256, active.metadata.candidateSha256) ||
    !bytesEqualFullScan(
      runtime.candidate.runtimeProjectionSetSha256,
      active.metadata.runtimeProjectionSetSha256,
    ) ||
    !bytesEqualFullScan(
      runtime.candidate.functionGroupManifestSha256,
      active.metadata.functionGroupManifestSha256,
    )
  ) {
    return yield* new ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error({
      reason: "candidateEvidenceMismatch", functionPath,
    });
  }
  const metadata = decoded.functions.find(
    item => item.metadata.functionPath === functionPath,
  );
  const entryAuthority = runtime.publication.functionEntries.find(
    item => item.frame.functionPath === functionPath,
  );
  if (metadata === undefined || entryAuthority === undefined) {
    return yield* new ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error({
      reason: "unknownFunction", functionPath,
    });
  }
  const argsValidator = metadata.metadata.argsValidator;
  if (
    metadata.metadata.kind !== "mutation" ||
    metadata.metadata.visibility !== "public" ||
    !isPointMutationArgsValidatorV1(argsValidator) ||
    entryAuthority.frame.handlerKind !== "mutation" ||
    entryAuthority.frame.visibility !== "public" ||
    entryAuthority.frame.group !== "transaction"
  ) {
    return yield* new ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error({
      reason: "unsupportedFunction", functionPath,
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
    !bytesEqualFullScan(
      entryAuthority.frame.projectionSha256,
      projectionAuthority.reference.sha256,
    ) ||
    !projectionAuthority.modules.some(
      module => module.modulePath === entryAuthority.frame.executionModule,
    )
  ) {
    return yield* new ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error({
      reason: "functionEvidenceMismatch", functionPath,
    });
  }
  const internalQueryCatalog:
    ApplicationRevisionMutationInternalQueryRuntimeTargetCatalogEntryV1[] = [];
  for (const internalMetadata of decoded.functions) {
    if (internalMetadata.metadata.kind !== "query" ||
      internalMetadata.metadata.visibility !== "internal") continue;
    const internalArgs = internalMetadata.metadata.argsValidator;
    const internalEntry = runtime.publication.functionEntries.find(
      item => item.frame.functionPath === internalMetadata.metadata.functionPath,
    );
    const internalSeparator = internalMetadata.metadata.functionPath.lastIndexOf(":");
    if (!isPointQueryArgsValidatorV1(internalArgs) ||
      internalEntry === undefined || internalSeparator <= 0 ||
      internalEntry.frame.functionOrdinal !== BigInt(internalMetadata.ordinal) ||
      internalEntry.frame.exportName !==
        internalMetadata.metadata.functionPath.slice(internalSeparator + 1) ||
      internalEntry.frame.handlerKind !== "query" ||
      internalEntry.frame.visibility !== "internal" ||
      internalEntry.frame.group !== "transaction" ||
      !bytesEqualFullScan(
        internalEntry.frame.projectionSha256,
        projectionAuthority.reference.sha256,
      ) ||
      !projectionAuthority.modules.some(
        module => module.modulePath === internalEntry.frame.executionModule,
      )) {
      return yield* new ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error({
        reason: "functionEvidenceMismatch",
        functionPath: internalMetadata.metadata.functionPath,
      });
    }
    internalQueryCatalog.push(Object.freeze({
      functionOrdinal: BigInt(internalMetadata.ordinal),
      functionPath: internalMetadata.metadata.functionPath,
      logicalExecutionModule: internalMetadata.metadata.executionModule,
      artifactExecutionModule: internalEntry.frame.executionModule,
      exportName: internalEntry.frame.exportName,
      handlerKind: "query" as const,
      visibility: "internal" as const,
      argsValidator: internalArgs,
      returnsValidator: internalMetadata.metadata.returnsValidator,
      entry: internalEntry.frame as typeof internalEntry.frame & {
        readonly handlerKind: "query";
        readonly visibility: "internal";
        readonly group: "transaction";
      },
      entryReference: internalEntry.reference,
    }));
  }
  internalQueryCatalog.sort((left, right) =>
    left.functionOrdinal < right.functionOrdinal ? -1
      : left.functionOrdinal > right.functionOrdinal ? 1
      : left.functionPath.localeCompare(right.functionPath));
  for (let index = 1; index < internalQueryCatalog.length; index += 1) {
    const previous = internalQueryCatalog[index - 1]!;
    const current = internalQueryCatalog[index]!;
    if (previous.functionOrdinal === current.functionOrdinal ||
      previous.functionPath === current.functionPath) {
      return yield* new ApplicationRevisionMutationInternalQueryRuntimeTargetV1Error({
        reason: "functionEvidenceMismatch",
        functionPath: current.functionPath,
      });
    }
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
      visibility: "public" as const,
      argsValidator,
      returnsValidator: metadata.metadata.returnsValidator,
      entry: entryAuthority.frame as typeof entryAuthority.frame & {
        readonly handlerKind: "mutation";
        readonly visibility: "public";
        readonly group: "transaction";
      },
      entryReference: entryAuthority.reference,
      projection: projectionAuthority.frame as typeof projectionAuthority.frame & {
        readonly group: "transaction";
      },
    }),
    internalQueryCatalog: Object.freeze(internalQueryCatalog),
  });
});
