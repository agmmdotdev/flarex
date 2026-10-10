import { Effect } from "effect";
import { hasApplicationRelationCommitAuthorityForPointCommit } from "../../application/relations/applicationRelationCommit";
import { type StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../authority/postgresLoader";
import {
  preliminaryAuthorityFailure,
  resolvePointCommitAuthority,
} from "./attemptAcceptance";
import { type PointCommitTransactionProofOptionsV1 } from "./constructionContracts";
import {
  type PointCommitRollbackProofPortV1,
  type PointCommitWouldCommitV1,
} from "./contracts";
import { runPointCommitTransactionKernel } from "./durablePublication";
import { corruption } from "./errors";
import { observePointCommitPublicationEffect } from "./observation";
import {
  preparePointCommitCommand,
  preparePointCommitMixedDefinitions,
} from "./preparation";
import { type PreparedPointCommitTransactionCommandV1 } from "./preparedCommands";
import { runPointCommitPromiseEffect } from "./promiseBoundary";
import { mapTransactionFailure } from "./sqlFailures";
import { type captureExecutionDiagnosticContext } from "../../execution/diagnostics/operation";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";
import {
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../database/locatedTransactionIdentity";
import { type TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { closeExactAttemptScopeClockObservation } from "../../scope/scopeClock";
import { hasAppSchemaCandidateWriteGuardComposition } from "../../storage/catalog/appSchemaCandidateValidation";
import { type LocatedAppIndexDefinitionV1 } from "../../storage/indexes/appIndexDefinitions";
import {
  emitTransactionStep,
  prepareApplicationRelationDefinitions,
  prepareCandidateSchemaWriteGuard,
  prepareIntrinsicIndexDefinitions,
} from "../../storage/materialization/materialization";
import {
  type PreparedPointCommitApplicationRelations,
  type PreparedPointCommitCandidateSchemaWriteGuard,
} from "../../storage/materialization/model";
import { type LocatedAppUniqueConstraintDefinitionV1 } from "../../storage/unique/appUniqueConstraintDefinitions";

export const WOULD_COMMIT = Object.freeze({
  kind: "wouldCommit",
} satisfies PointCommitWouldCommitV1);

export const ROLLBACK_SENTINEL = Object.freeze({
  kind: "pointCommitRollbackSentinel",
});

export async function runRollbackProof(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  intrinsicDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  applicationRelations: PreparedPointCommitApplicationRelations | null,
  candidateSchemaWriteGuard:
    PreparedPointCommitCandidateSchemaWriteGuard | null,
  options: PointCommitTransactionProofOptionsV1,
  diagnosticContext: ReturnType<typeof captureExecutionDiagnosticContext>,
): Promise<PointCommitWouldCommitV1> {
  try {
    await target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
      try {
        await runPointCommitTransactionKernel(
          tx,
          target,
          preliminaryAuthority,
          command,
          intrinsicDefinitions,
          developerDefinitions,
          uniqueDefinitions,
          applicationRelations,
          candidateSchemaWriteGuard,
          options,
          "rollbackProof",
          diagnosticContext,
        );
        await emitTransactionStep(options, command, "beforeRollback");
        throw ROLLBACK_SENTINEL;
      } finally { closeExactAttemptScopeClockObservation(tx); }
    });
  } catch (cause) {
    if (cause === ROLLBACK_SENTINEL) return WOULD_COMMIT;
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === ROLLBACK_SENTINEL
    ) {
      return WOULD_COMMIT;
    }
    throw cause;
  }
  throw corruption("rollbackSentinelMissing");
}

export function bindPointCommitRollbackProof(ports: StoredCommitAuthorityEvidenceLoaderPortsV1, capturedOptions: PointCommitTransactionProofOptionsV1, hasOrderedIndexes: boolean): PointCommitRollbackProofPortV1["prove"] {
  const prove: PointCommitRollbackProofPortV1["prove"] = Effect.fn(
    "PointCommitTransaction.proveRollback",
  )(function* (input) {
    const command = yield* preparePointCommitCommand(input);
    const located = yield* resolvePointCommitAuthority(
      command.authorityPins,
      ports,
    );
    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(preliminaryFailure);
    }
    const target = isLocatedReadCommittedAttemptTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    if (command.authorityPins.executionAuthorityGeneration === "application_v1" &&
      command.rowIntents.length > 0 && !hasOrderedIndexes) {
      return yield* Effect.fail(corruption("orderedIndexCompositionInvalid"));
    }
    const intrinsicDefinitions = yield* prepareIntrinsicIndexDefinitions(
      command,
      capturedOptions,
    );
    const mixedDefinitions = yield* observePointCommitPublicationEffect(capturedOptions.publicationObservation, "mixedDefinitions", preparePointCommitMixedDefinitions(command, capturedOptions));
    const developerDefinitions = mixedDefinitions.developerDefinitions;
    const uniqueDefinitions = mixedDefinitions.uniqueDefinitions;
    const mixedCommand = Object.freeze({
      ...command,
      sourceSchemaVersionByTable: mixedDefinitions.sourceSchemaVersionByTable
    });
    const applicationRelations = yield* prepareApplicationRelationDefinitions(
      command,
      { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
      capturedOptions,
    );
    const candidateSchemaWriteGuard = yield* prepareCandidateSchemaWriteGuard(
      command,
      { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
      capturedOptions,
    );
    return yield* Effect.uninterruptible(runPointCommitPromiseEffect(diagnosticContext => runRollbackProof(
      target,
      located.authority,
      mixedCommand,
      intrinsicDefinitions,
      developerDefinitions,
      uniqueDefinitions,
      applicationRelations,
      candidateSchemaWriteGuard,
      capturedOptions,
      diagnosticContext,
    ), mapTransactionFailure));
  });
  return prove;
}
