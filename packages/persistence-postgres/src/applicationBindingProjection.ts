import type { JsonObject } from "flarex-protocol/json";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { encodeBytesToLowercaseHex as hex } from "@flarex/utils/bytes";
import { Effect } from "effect";
import {
  validateApplicationBindingBasisInTransaction,
  withValidatedApplicationBindingBasisInTransaction,
  withPreparedApplicationBindingBasisInTransaction,
  type PreparedApplicationBinding,
  type ApplicationBindingInput,
  type AcceptedApplicationBinding,
  type ApplicationBindingObservation,
  readAcceptedApplicationBinding,
  withStandaloneApplicationBindingInTransaction,
  type PreparedStandaloneApplicationBinding,
} from "./applicationActivation";
import type { AppRowTransaction } from "./appRows";
import type { CheckedApplicationActiveHead } from "./applicationActiveHeadRead";
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

/** A candidate's observed revocation epoch authorizes its proposal, while an
 * activated binding's receipt owns its accepted epoch. Every other selected
 * Application field remains immutable identity in both phases. */
export function immutableApplicationBindingReference(reference: ApplicationBindingReference) {
  const { authorizationRevocationEpoch: _observedEpoch, ...selection } = reference;
  return selection;
}

export const readApplicationBindingProjectionInTransaction = Effect.fn(
  "ApplicationBindingProjection.readInTransaction",
)(function* (
  selection: ApplicationBindingInput,
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
) {
  return (yield* readApplicationBindingEvidenceInTransaction(selection, tx, clock)).projection;
});

/** Fresh projection and source correlation from the same nominal selection.
 * Plain evidence only; the accepting owner retains the transaction lifetime. */
export const readApplicationBindingEvidenceInTransaction = Effect.fn(
  "ApplicationBindingProjection.readEvidenceInTransaction",
)(function* (selection: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord) {
  return yield* withApplicationBindingEvidenceInTransaction(selection, tx, clock, evidence =>
    Effect.succeed(Object.freeze({ projection: evidence.projection, analysis: evidence.analysis })));
});

export type ApplicationBindingEvidence = Readonly<{ projection: ApplicationBindingReference;
  analysis: Readonly<{ candidateId: string; analysisId: string; manifestSha256: string; sourceArtifactRootSha256: string }>;
  checkedActive: CheckedApplicationActiveHead | undefined }>;
/** The exact host publication supplies immutable correlation; revocation and
 * acceptance remain request-local inside the original snapshot and final guard. */
export const withStandaloneApplicationBindingEvidenceInTransaction = Effect.fn(
  "ApplicationBindingProjection.withStandaloneEvidence",
)(function* <Value, Failure, Requirements>(selection: PreparedStandaloneApplicationBinding, tx: AppRowTransaction,
  clock: ScopeClockRecord, work: (evidence: ApplicationBindingEvidence) => Effect.Effect<Value, Failure, Requirements>) {
  return yield* withStandaloneApplicationBindingInTransaction(selection, tx, clock, state => Effect.gen(function* () {
    const authorizationRevocationEpoch = yield* requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, clock.scopeId);
    const { format: _format, analysis, ...immutable } = state.frame;
    const projection: ApplicationBindingReference = { ...immutable,
      physicalLocator: { ...state.authority.physicalLocator }, authorizationRevocationEpoch: authorizationRevocationEpoch.toString() };
    return yield* Effect.suspend(() => work({ projection, analysis, checkedActive: undefined }));
  }));
});

/** The checked active observation is valid only while this accepting callback runs. */
export const withApplicationBindingEvidenceInTransaction = Effect.fn(
  "ApplicationBindingProjection.withEvidenceInTransaction",
)(function* <Value, Failure, Requirements>(selection: ApplicationBindingInput, tx: AppRowTransaction,
  clock: ScopeClockRecord,
  work: (evidence: ApplicationBindingEvidence, accepted: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  observation?: ApplicationBindingObservation) {
  return yield* withValidatedApplicationBindingBasisInTransaction(selection, tx, clock, (validated, checkedActive, accepted) =>
    projectApplicationBindingEvidence(validated, checkedActive, tx, clock).pipe(
      Effect.flatMap(evidence => Effect.suspend(() => work(evidence, accepted)))), observation);
});

/** Only the standalone trusted owner completes business work in this callback. */
export const withPreparedApplicationBindingEvidenceInTransaction = Effect.fn(
  "ApplicationBindingProjection.withPreparedEvidenceInTransaction",
)(function* <Value, Failure, Requirements>(selection: PreparedApplicationBinding, tx: AppRowTransaction,
  clock: ScopeClockRecord, work: (evidence: ApplicationBindingEvidence, accepted: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  entryHead?: CheckedApplicationActiveHead) {
  return yield* withPreparedApplicationBindingBasisInTransaction(selection, tx, clock, (validated, checkedActive, accepted) =>
    projectApplicationBindingEvidence(validated, checkedActive, tx, clock).pipe(
      Effect.flatMap(evidence => Effect.suspend(() => work(evidence, accepted)))), entryHead);
});

const projectApplicationBindingEvidence = Effect.fn("ApplicationBindingProjection.projectEvidence")(
  function* (validated: Effect.Success<ReturnType<typeof validateApplicationBindingBasisInTransaction>>,
    checkedActive: CheckedApplicationActiveHead | undefined, tx: AppRowTransaction, clock: ScopeClockRecord) {
    const projection = yield* projectApplicationBindingInTransaction(validated, tx, clock);
    const basis = validated.basis;
    const evidence = Object.freeze({ projection, analysis: Object.freeze({ candidateId: basis.candidateId,
      analysisId: basis.analysisId, manifestSha256: hex(basis.manifestSha256),
      sourceArtifactRootSha256: hex(basis.sourceArtifactRootSha256) }), checkedActive });
    return evidence;
  },
);

export const readAcceptedApplicationBindingProjection = Effect.fn("ApplicationBindingProjection.readAccepted")(
  function* (binding: AcceptedApplicationBinding, tx: AppRowTransaction, clock: ScopeClockRecord) {
    const basis = yield* Effect.fromResult(readAcceptedApplicationBinding(binding, tx, clock));
    return yield* projectApplicationBindingInTransaction({ kind: "relation", basis }, tx, clock);
  },
);

const projectApplicationBindingInTransaction = Effect.fn("ApplicationBindingProjection.project")(
  function* (validated: Effect.Success<ReturnType<typeof validateApplicationBindingBasisInTransaction>>,
    tx: AppRowTransaction, clock: ScopeClockRecord) {
  const basis = validated.basis;
  // The scope-clock owner lends the authentic command-one observation for a
  // finite entry. Ordinary readers retain its live revocation-lock path.
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
