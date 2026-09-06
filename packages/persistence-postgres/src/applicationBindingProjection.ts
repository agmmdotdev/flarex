import type { JsonObject } from "flarex-protocol/json";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { encodeBytesToLowercaseHex as hex } from "@flarex/utils/bytes";
import { Effect } from "effect";
import {
  validateApplicationBindingBasisInTransaction,
  type ApplicationActiveSelection,
} from "./applicationActivation";
import type { AppRowTransaction } from "./appRows";
import type { ScopeClockRecord } from "./scopeClock";
import { requireScopeAuthorizationRevocationEpochInTransactionEffect } from "./scopeClock";

export type ApplicationBindingReference = Readonly<{
  deploymentId: string;
  scopeId: string;
  physicalLocator: ScopePhysicalLocator;
  storageGeneration: string;
  storageGenerationFence: string;
  epoch: string;
  authorizationRevocationEpoch: string;
  activationSequence: string;
  headSha256: string;
  activationSha256: string;
  revisionId: string;
  schemaVersionId: string;
  applicationSchemaSha256: string;
  schemaManifestSha256: string;
  readinessSha256: string;
  readiness:
    | Readonly<{ kind: "legacy"; schemaBindingSha256: string }>
    | Readonly<{
        kind: "relation";
        manifestSchemaBindingSha256: string;
        boundPublicationSha256: string;
        relationFrontierCommitSeq: string;
        relationSetReadinessSha256: string;
        relationCount: number;
      }>
    | Readonly<{
        kind: "policy";
        manifestSchemaBindingSha256: string;
        boundPublicationSha256: string;
        relationFrontierCommitSeq: string;
        relationSetReadinessSha256: string;
        relationCount: number;
        writePolicySetSha256: string;
        writeOwnershipSha256: string;
      }>;
}> &
  JsonObject;

export const readApplicationBindingProjectionInTransaction = Effect.fn(
  "ApplicationBindingProjection.readInTransaction",
)(function* (
  selection: ApplicationActiveSelection,
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
) {
  const validated = yield* validateApplicationBindingBasisInTransaction(
    selection,
    tx,
    clock,
  );
  const basis = validated.basis;
  const authorizationRevocationEpoch =
    yield* requireScopeAuthorizationRevocationEpochInTransactionEffect(
      tx,
      clock.scopeId,
    );
  const common = {
    deploymentId: basis.deploymentId,
    scopeId: basis.authority.scopeId,
    physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    storageGeneration: basis.authority.storageGeneration.toString(),
    storageGenerationFence: basis.authority.storageGenerationFence.toString(),
    epoch: basis.authority.epoch.toString(),
    authorizationRevocationEpoch: authorizationRevocationEpoch.toString(),
    activationSequence: basis.activationSequence.toString(),
    headSha256: hex(basis.headSha256),
    activationSha256: hex(basis.activationSha256),
    revisionId: basis.revisionId,
    schemaVersionId: basis.schemaVersionId,
    applicationSchemaSha256: hex(basis.applicationSchemaSha256),
    schemaManifestSha256: hex(basis.schemaManifestSha256),
    readinessSha256: hex(basis.readinessSha256),
  };
  const readiness =
    validated.kind === "legacy"
      ? Object.freeze({
          kind: "legacy" as const,
          schemaBindingSha256: hex(validated.basis.schemaBindingSha256),
        })
      : Object.freeze({
          ...(validated.basis.writeOwnership === null ? { kind: "relation" as const } : {
            kind: "policy" as const,
            writePolicySetSha256: validated.basis.writeOwnership.frame.writePolicySetSha256,
            writeOwnershipSha256: validated.basis.writeOwnership.sha256Hex,
          }),
          manifestSchemaBindingSha256: hex(
            validated.basis.manifestSchemaBindingSha256,
          ),
          boundPublicationSha256: hex(validated.basis.boundPublicationSha256),
          relationFrontierCommitSeq: validated.basis.relationFrontierCommitSeq,
          relationSetReadinessSha256: hex(
            validated.basis.relationSetReadinessSha256,
          ),
          relationCount: validated.basis.relationCount,
        });
  return Object.freeze({
    ...common,
    readiness,
  }) satisfies ApplicationBindingReference;
});
