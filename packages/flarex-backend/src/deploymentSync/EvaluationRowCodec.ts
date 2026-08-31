import {
  MAX_QUERY_GENERATION,
  captureCanonicalQueryKey,
  captureQueryAuthorityWitness,
  captureQueryResultDigest,
  makeQueryPublicationIdentity,
  pendingPublicationDisposition,
  unchangedPublicationDisposition,
  type ProvisionalQueryState,
  type QueryPublicationIdentity,
} from "@flarex/query-sync/internal/kernel";
import type {
  ActiveQueryScalarFacts,
  CompleteQueryScalarFacts,
  EvaluationAttemptCompletionFacts,
  EvaluationAttemptOutcomeQueryFacts,
  EvaluationSelectedQueryFacts,
  EvaluationWorkScanFacts,
  QueryCompletionScalarFacts,
  QuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import { Result, Schema } from "effect";

import {
  captureDeploymentQuerySyncCanonicalValueResult,
  decodeDeploymentQuerySyncBaseQueryRowValuesResult,
  decodeDeploymentQuerySyncGenerationResult,
  decodeDeploymentQuerySyncNullableGenerationResult,
  decodeDeploymentQuerySyncNullableSequenceResult,
  decodeDeploymentQuerySyncRowShapeResult,
  decodeDeploymentQuerySyncSequenceResult,
  decodeDeploymentQuerySyncSnapshotResult,
  deploymentQuerySyncBaseQueryRowSchemaFields,
  deploymentQuerySyncRowCodecError,
  type DeploymentQuerySyncBaseQueryRowValues,
  type DeploymentQuerySyncRowCodecError,
} from "./RowCodec";

export const DEPLOYMENT_QUERY_SYNC_COMPLETE_QUERY_COLUMNS = `
  query_key,
  query_identity,
  active_generation,
  active_evaluation_snapshot_sequence,
  active_fresh_through_sequence,
  active_dirty_through_sequence,
  active_result_digest,
  active_authority_witness,
  provisional_generation,
  provisional_expected_active_generation,
  provisional_registration_sequence,
  provisional_requested_dirty_through_sequence,
  provisional_disposition,
  completion_generation,
  completion_expected_active_generation,
  completion_registration_sequence,
  completion_requested_dirty_through_sequence,
  completion_evaluation_snapshot_sequence,
  completion_evaluation_authority_witness,
  completion_refreshed_through_sequence,
  completion_relevant_through_sequence,
  completion_refresh_authority_witness,
  completion_result_digest,
  completion_publication_disposition,
  preceding_completion_generation`;

export interface EncodedDeploymentQuerySyncCompleteQueryRow
  extends DeploymentQuerySyncBaseQueryRowValues {
  readonly provisional_disposition: "ready" | "blocked" | null;
  readonly completion_generation: string | null;
  readonly completion_expected_active_generation: string | null;
  readonly completion_registration_sequence: string | null;
  readonly completion_requested_dirty_through_sequence: string | null;
  readonly completion_evaluation_snapshot_sequence: string | null;
  readonly completion_evaluation_authority_witness: string | null;
  readonly completion_refreshed_through_sequence: string | null;
  readonly completion_relevant_through_sequence: string | null;
  readonly completion_refresh_authority_witness: string | null;
  readonly completion_result_digest: string | null;
  readonly completion_publication_disposition:
    | "unchanged"
    | "pending"
    | null;
  readonly preceding_completion_generation: string | null;
}

const completionFields = {
  completion_generation: Schema.NullOr(Schema.String),
  completion_expected_active_generation: Schema.NullOr(Schema.String),
  completion_registration_sequence: Schema.NullOr(Schema.String),
  completion_requested_dirty_through_sequence: Schema.NullOr(Schema.String),
  completion_evaluation_snapshot_sequence: Schema.NullOr(Schema.String),
  completion_evaluation_authority_witness: Schema.NullOr(Schema.String),
  completion_refreshed_through_sequence: Schema.NullOr(Schema.String),
  completion_relevant_through_sequence: Schema.NullOr(Schema.String),
  completion_refresh_authority_witness: Schema.NullOr(Schema.String),
  completion_result_digest: Schema.NullOr(Schema.String),
  completion_publication_disposition: Schema.NullOr(Schema.String),
  preceding_completion_generation: Schema.NullOr(Schema.String),
} as const;

const RawCompleteQueryRowSchema = Schema.Struct({
  ...deploymentQuerySyncBaseQueryRowSchemaFields,
  ...completionFields,
});

const RawEvaluationAttemptOutcomeRowSchema = Schema.Struct({
  ...deploymentQuerySyncBaseQueryRowSchemaFields,
  completion_generation: completionFields.completion_generation,
  completion_expected_active_generation:
    completionFields.completion_expected_active_generation,
  completion_registration_sequence:
    completionFields.completion_registration_sequence,
  completion_requested_dirty_through_sequence:
    completionFields.completion_requested_dirty_through_sequence,
  preceding_completion_generation:
    completionFields.preceding_completion_generation,
});

const RawEvaluationWorkScanRowSchema = Schema.Struct({
  query_key: Schema.String,
  active_generation: Schema.NullOr(Schema.String),
  active_dirty_through_sequence: Schema.NullOr(Schema.String),
  provisional_generation: Schema.NullOr(Schema.String),
  provisional_disposition: Schema.NullOr(Schema.String),
});

const strictRowOptions = { onExcessProperty: "error" } as const;
const decodeRawCompleteQueryRow = Schema.decodeUnknownResult(
  RawCompleteQueryRowSchema,
  strictRowOptions,
);
const decodeRawEvaluationAttemptOutcomeRow = Schema.decodeUnknownResult(
  RawEvaluationAttemptOutcomeRowSchema,
  strictRowOptions,
);
const decodeRawEvaluationWorkScanRow = Schema.decodeUnknownResult(
  RawEvaluationWorkScanRowSchema,
  strictRowOptions,
);

function completionGroupAbsent(row: {
  readonly completion_generation: string | null;
  readonly completion_expected_active_generation: string | null;
  readonly completion_registration_sequence: string | null;
  readonly completion_requested_dirty_through_sequence: string | null;
  readonly completion_evaluation_snapshot_sequence: string | null;
  readonly completion_evaluation_authority_witness: string | null;
  readonly completion_refreshed_through_sequence: string | null;
  readonly completion_relevant_through_sequence: string | null;
  readonly completion_refresh_authority_witness: string | null;
  readonly completion_result_digest: string | null;
  readonly completion_publication_disposition: string | null;
  readonly preceding_completion_generation: string | null;
}): boolean {
  return row.completion_generation === null
    && row.completion_expected_active_generation === null
    && row.completion_registration_sequence === null
    && row.completion_requested_dirty_through_sequence === null
    && row.completion_evaluation_snapshot_sequence === null
    && row.completion_evaluation_authority_witness === null
    && row.completion_refreshed_through_sequence === null
    && row.completion_relevant_through_sequence === null
    && row.completion_refresh_authority_witness === null
    && row.completion_result_digest === null
    && row.completion_publication_disposition === null
    && row.preceding_completion_generation === null;
}

function publicationIdentity(
  scope: QuerySyncScopeFacts,
  queryKey: CompleteQueryScalarFacts["descriptor"]["queryKey"],
  generation: QueryCompletionScalarFacts["identity"]["generation"],
): QueryPublicationIdentity {
  return makeQueryPublicationIdentity({
    namespaceId: scope.cursor.namespaceId,
    syncModelId: scope.cursor.syncModelId,
    sourceEpoch: scope.cursor.sourceEpoch,
    queryKey,
    generation,
  });
}

function completionAttemptLinksValid(
  scope: QuerySyncScopeFacts,
  active: ActiveQueryScalarFacts,
  completion: EvaluationAttemptCompletionFacts,
  preceding: QueryPublicationIdentity | null,
): boolean {
  const registration = completion.registrationCursor;
  if (
    completion.identity.generation !== active.generation
    || registration.namespaceId !== scope.cursor.namespaceId
    || registration.syncModelId !== scope.cursor.syncModelId
    || registration.sourceEpoch !== scope.cursor.sourceEpoch
    || registration.appliedThroughSequence > scope.cursor.appliedThroughSequence
    || registration.appliedThroughSequence > active.evaluationSnapshotSequence
  ) {
    return false;
  }
  if (completion.expectedActiveGeneration === null) {
    return completion.identity.generation === 1n
      && completion.requestedDirtyThroughSequence === null
      && preceding === null;
  }
  return completion.expectedActiveGeneration < MAX_QUERY_GENERATION
    && completion.identity.generation
      === completion.expectedActiveGeneration + 1n
    && preceding !== null
    && preceding.generation === completion.expectedActiveGeneration
    && completion.requestedDirtyThroughSequence !== null
    && completion.requestedDirtyThroughSequence
      <= active.evaluationSnapshotSequence;
}

function completionLinksValid(
  scope: QuerySyncScopeFacts,
  active: ActiveQueryScalarFacts,
  completion: QueryCompletionScalarFacts,
  preceding: QueryPublicationIdentity | null,
): boolean {
  return completionAttemptLinksValid(scope, active, completion, preceding)
    && completion.evaluationSnapshotSequence
      === active.evaluationSnapshotSequence
    && completion.refreshedThroughSequence === active.freshThroughSequence
    && completion.relevantThroughSequence === null
    && completion.evaluationAuthorityWitness === active.authorityWitness
    && completion.refreshAuthorityWitness === active.authorityWitness
    && completion.resultDigest === active.resultDigest;
}

function decodeCompletion(
  row: Schema.Schema.Type<typeof RawCompleteQueryRowSchema>,
  scope: QuerySyncScopeFacts,
  facts: CompleteQueryScalarFacts,
): Result.Result<
  Readonly<{
    readonly currentCompletion: QueryCompletionScalarFacts | null;
    readonly precedingCompletionIdentity: QueryPublicationIdentity | null;
  }>,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    if (row.completion_generation === null) {
      if (!completionGroupAbsent(row) || facts.active !== null) {
        return yield* Result.fail(deploymentQuerySyncRowCodecError(
          "evaluationQuery",
          "completionGroupInvalid",
          null,
        ));
      }
      return Object.freeze({
        currentCompletion: null,
        precedingCompletionIdentity: null,
      });
    }
    if (
      facts.active === null
      || row.completion_registration_sequence === null
      || row.completion_evaluation_snapshot_sequence === null
      || row.completion_evaluation_authority_witness === null
      || row.completion_refreshed_through_sequence === null
      || row.completion_relevant_through_sequence !== null
      || row.completion_refresh_authority_witness === null
      || row.completion_result_digest === null
      || (
        row.completion_publication_disposition !== "unchanged"
        && row.completion_publication_disposition !== "pending"
      )
    ) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "evaluationQuery",
        "completionGroupInvalid",
        null,
      ));
    }
    const generation = yield* decodeDeploymentQuerySyncGenerationResult(
      "evaluationQuery",
      "completion_generation",
      row.completion_generation,
    );
    const identity = publicationIdentity(
      scope,
      facts.descriptor.queryKey,
      generation,
    );
    const registrationSequence = yield* decodeDeploymentQuerySyncSequenceResult(
      "evaluationQuery",
      "completion_registration_sequence",
      row.completion_registration_sequence,
    );
    const precedingGeneration = yield*
      decodeDeploymentQuerySyncNullableGenerationResult(
        "evaluationQuery",
        "preceding_completion_generation",
        row.preceding_completion_generation,
      );
    const precedingCompletionIdentity = precedingGeneration === null
      ? null
      : publicationIdentity(scope, facts.descriptor.queryKey, precedingGeneration);
    const completion: QueryCompletionScalarFacts = Object.freeze({
      identity,
      queryIdentity: facts.descriptor.queryIdentity,
      expectedActiveGeneration: yield*
        decodeDeploymentQuerySyncNullableGenerationResult(
          "evaluationQuery",
          "completion_expected_active_generation",
          row.completion_expected_active_generation,
        ),
      registrationCursor: Object.freeze({
        namespaceId: scope.cursor.namespaceId,
        syncModelId: scope.cursor.syncModelId,
        sourceEpoch: scope.cursor.sourceEpoch,
        appliedThroughSequence: registrationSequence,
      }),
      requestedDirtyThroughSequence: yield*
        decodeDeploymentQuerySyncNullableSequenceResult(
          "evaluationQuery",
          "completion_requested_dirty_through_sequence",
          row.completion_requested_dirty_through_sequence,
        ),
      evaluationSnapshotSequence: yield*
        decodeDeploymentQuerySyncSnapshotResult(
          "evaluationQuery",
          "completion_evaluation_snapshot_sequence",
          row.completion_evaluation_snapshot_sequence,
        ),
      evaluationAuthorityWitness: yield*
        captureDeploymentQuerySyncCanonicalValueResult(
          "evaluationQuery",
          "completion_evaluation_authority_witness",
          captureQueryAuthorityWitness(
            row.completion_evaluation_authority_witness,
          ),
        ),
      refreshedThroughSequence: yield* decodeDeploymentQuerySyncSequenceResult(
        "evaluationQuery",
        "completion_refreshed_through_sequence",
        row.completion_refreshed_through_sequence,
      ),
      relevantThroughSequence: null,
      refreshAuthorityWitness: yield*
        captureDeploymentQuerySyncCanonicalValueResult(
          "evaluationQuery",
          "completion_refresh_authority_witness",
          captureQueryAuthorityWitness(
            row.completion_refresh_authority_witness,
          ),
        ),
      resultDigest: yield* captureDeploymentQuerySyncCanonicalValueResult(
        "evaluationQuery",
        "completion_result_digest",
        captureQueryResultDigest(row.completion_result_digest),
      ),
      publicationDisposition:
        row.completion_publication_disposition === "pending"
          ? pendingPublicationDisposition(identity)
          : unchangedPublicationDisposition(),
    });
    if (!completionLinksValid(
      scope,
      facts.active,
      completion,
      precedingCompletionIdentity,
    )) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "evaluationQuery",
        "completionFactsInvalid",
        null,
      ));
    }
    return Object.freeze({
      currentCompletion: completion,
      precedingCompletionIdentity,
    });
  });
}

export function decodeDeploymentQuerySyncCompleteQueryRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
): Result.Result<CompleteQueryScalarFacts, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const row = yield* decodeDeploymentQuerySyncRowShapeResult(
      "evaluationQuery",
      decodeRawCompleteQueryRow(input),
    );
    const base = yield* decodeDeploymentQuerySyncBaseQueryRowValuesResult(
      row,
      scope,
      "evaluationQuery",
    );
    const emptyFacts: CompleteQueryScalarFacts = Object.freeze({
      ...base,
      currentCompletion: null,
      precedingCompletionIdentity: null,
    });
    const completion = yield* decodeCompletion(row, scope, emptyFacts);
    return Object.freeze({
      ...base,
      currentCompletion: completion.currentCompletion,
      precedingCompletionIdentity:
        completion.precedingCompletionIdentity,
    });
  });
}

export function encodeDeploymentQuerySyncCompleteQueryRow(
  facts: CompleteQueryScalarFacts,
): EncodedDeploymentQuerySyncCompleteQueryRow {
  const active = facts.active;
  const provisional = facts.provisional;
  const completion = facts.currentCompletion;
  return Object.freeze({
    query_key: facts.descriptor.queryKey,
    query_identity: facts.descriptor.queryIdentity,
    active_generation: active?.generation.toString() ?? null,
    active_evaluation_snapshot_sequence:
      active?.evaluationSnapshotSequence.toString() ?? null,
    active_fresh_through_sequence:
      active?.freshThroughSequence.toString() ?? null,
    active_dirty_through_sequence:
      active?.dirtyThroughSequence?.toString() ?? null,
    active_result_digest: active?.resultDigest ?? null,
    active_authority_witness: active?.authorityWitness ?? null,
    provisional_generation: provisional?.generation.toString() ?? null,
    provisional_expected_active_generation:
      provisional?.expectedActiveGeneration?.toString() ?? null,
    provisional_registration_sequence:
      provisional?.registrationCursor.appliedThroughSequence.toString()
        ?? null,
    provisional_requested_dirty_through_sequence:
      provisional?.requestedDirtyThroughSequence?.toString() ?? null,
    provisional_disposition: provisional?.evaluationDisposition._tag ?? null,
    completion_generation: completion?.identity.generation.toString() ?? null,
    completion_expected_active_generation:
      completion?.expectedActiveGeneration?.toString() ?? null,
    completion_registration_sequence:
      completion?.registrationCursor.appliedThroughSequence.toString() ?? null,
    completion_requested_dirty_through_sequence:
      completion?.requestedDirtyThroughSequence?.toString() ?? null,
    completion_evaluation_snapshot_sequence:
      completion?.evaluationSnapshotSequence.toString() ?? null,
    completion_evaluation_authority_witness:
      completion?.evaluationAuthorityWitness ?? null,
    completion_refreshed_through_sequence:
      completion?.refreshedThroughSequence.toString() ?? null,
    completion_relevant_through_sequence:
      completion?.relevantThroughSequence?.toString() ?? null,
    completion_refresh_authority_witness:
      completion?.refreshAuthorityWitness ?? null,
    completion_result_digest: completion?.resultDigest ?? null,
    completion_publication_disposition:
      completion?.publicationDisposition._tag ?? null,
    preceding_completion_generation:
      facts.precedingCompletionIdentity?.generation.toString() ?? null,
  });
}

function freezeProvisional(
  provisional: ProvisionalQueryState,
): ProvisionalQueryState {
  return Object.freeze({
    generation: provisional.generation,
    expectedActiveGeneration: provisional.expectedActiveGeneration,
    registrationCursor: Object.freeze({ ...provisional.registrationCursor }),
    requestedDirtyThroughSequence:
      provisional.requestedDirtyThroughSequence,
    evaluationDisposition: provisional.evaluationDisposition._tag === "ready"
      ? Object.freeze({ _tag: "ready" as const })
      : Object.freeze({ ...provisional.evaluationDisposition }),
  });
}

function freezeActive(active: ActiveQueryScalarFacts): ActiveQueryScalarFacts {
  return Object.freeze({ ...active });
}

export function projectDeploymentQuerySyncEvaluationSelectedQueryFacts(
  facts: CompleteQueryScalarFacts,
): EvaluationSelectedQueryFacts {
  return Object.freeze({
    descriptor: Object.freeze({ ...facts.descriptor }),
    active: facts.active === null ? null : freezeActive(facts.active),
    provisional: facts.provisional === null
      ? null
      : freezeProvisional(facts.provisional),
  });
}

function attemptCompletion(
  completion: QueryCompletionScalarFacts,
): EvaluationAttemptCompletionFacts {
  return Object.freeze({
    identity: Object.freeze({ ...completion.identity }),
    queryIdentity: completion.queryIdentity,
    expectedActiveGeneration: completion.expectedActiveGeneration,
    registrationCursor: Object.freeze({ ...completion.registrationCursor }),
    requestedDirtyThroughSequence:
      completion.requestedDirtyThroughSequence,
  });
}

export function projectDeploymentQuerySyncEvaluationAttemptOutcomeQueryFacts(
  facts: CompleteQueryScalarFacts,
): EvaluationAttemptOutcomeQueryFacts {
  return Object.freeze({
    descriptor: Object.freeze({ ...facts.descriptor }),
    active: facts.active === null ? null : freezeActive(facts.active),
    provisional: facts.provisional === null
      ? null
      : freezeProvisional(facts.provisional),
    currentCompletion: facts.currentCompletion === null
      ? null
      : attemptCompletion(facts.currentCompletion),
    precedingCompletionIdentity:
      facts.precedingCompletionIdentity === null
        ? null
        : Object.freeze({ ...facts.precedingCompletionIdentity }),
  });
}

export function decodeDeploymentQuerySyncEvaluationAttemptOutcomeRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
): Result.Result<
  EvaluationAttemptOutcomeQueryFacts,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeDeploymentQuerySyncRowShapeResult(
      "evaluationAttemptOutcome",
      decodeRawEvaluationAttemptOutcomeRow(input),
    );
    const base = yield* decodeDeploymentQuerySyncBaseQueryRowValuesResult(
      row,
      scope,
      "evaluationAttemptOutcome",
    );
    if (row.completion_generation === null) {
      if (
        base.active !== null
        || row.completion_expected_active_generation !== null
        || row.completion_registration_sequence !== null
        || row.completion_requested_dirty_through_sequence !== null
        || row.preceding_completion_generation !== null
      ) {
        return yield* Result.fail(deploymentQuerySyncRowCodecError(
          "evaluationAttemptOutcome",
          "completionGroupInvalid",
          null,
        ));
      }
      return Object.freeze({
        ...base,
        currentCompletion: null,
        precedingCompletionIdentity: null,
      });
    }
    if (base.active === null || row.completion_registration_sequence === null) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "evaluationAttemptOutcome",
        "completionGroupInvalid",
        null,
      ));
    }
    const generation = yield* decodeDeploymentQuerySyncGenerationResult(
      "evaluationAttemptOutcome",
      "completion_generation",
      row.completion_generation,
    );
    const registrationSequence = yield* decodeDeploymentQuerySyncSequenceResult(
      "evaluationAttemptOutcome",
      "completion_registration_sequence",
      row.completion_registration_sequence,
    );
    const precedingGeneration = yield*
      decodeDeploymentQuerySyncNullableGenerationResult(
        "evaluationAttemptOutcome",
        "preceding_completion_generation",
        row.preceding_completion_generation,
      );
    const precedingCompletionIdentity = precedingGeneration === null
      ? null
      : publicationIdentity(scope, base.descriptor.queryKey, precedingGeneration);
    const completion: EvaluationAttemptCompletionFacts = Object.freeze({
      identity: publicationIdentity(scope, base.descriptor.queryKey, generation),
      queryIdentity: base.descriptor.queryIdentity,
      expectedActiveGeneration: yield*
        decodeDeploymentQuerySyncNullableGenerationResult(
          "evaluationAttemptOutcome",
          "completion_expected_active_generation",
          row.completion_expected_active_generation,
        ),
      registrationCursor: Object.freeze({
        namespaceId: scope.cursor.namespaceId,
        syncModelId: scope.cursor.syncModelId,
        sourceEpoch: scope.cursor.sourceEpoch,
        appliedThroughSequence: registrationSequence,
      }),
      requestedDirtyThroughSequence: yield*
        decodeDeploymentQuerySyncNullableSequenceResult(
          "evaluationAttemptOutcome",
          "completion_requested_dirty_through_sequence",
          row.completion_requested_dirty_through_sequence,
        ),
    });
    if (!completionAttemptLinksValid(
      scope,
      base.active,
      completion,
      precedingCompletionIdentity,
    )) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "evaluationAttemptOutcome",
        "completionFactsInvalid",
        null,
      ));
    }
    return Object.freeze({
      ...base,
      currentCompletion: completion,
      precedingCompletionIdentity,
    });
  });
}

export function decodeDeploymentQuerySyncEvaluationWorkScanRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
): Result.Result<EvaluationWorkScanFacts, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const row = yield* decodeDeploymentQuerySyncRowShapeResult(
      "evaluationWorkScan",
      decodeRawEvaluationWorkScanRow(input),
    );
    const queryKey = yield* captureDeploymentQuerySyncCanonicalValueResult(
      "evaluationWorkScan",
      "query_key",
      captureCanonicalQueryKey(row.query_key),
    );
    const activeGeneration = yield*
      decodeDeploymentQuerySyncNullableGenerationResult(
        "evaluationWorkScan",
        "active_generation",
        row.active_generation,
      );
    const activeDirty = yield* decodeDeploymentQuerySyncNullableSequenceResult(
      "evaluationWorkScan",
      "active_dirty_through_sequence",
      row.active_dirty_through_sequence,
    );
    const provisionalGeneration = yield*
      decodeDeploymentQuerySyncNullableGenerationResult(
        "evaluationWorkScan",
        "provisional_generation",
        row.provisional_generation,
      );
    const disposition = row.provisional_disposition;
    if (
      (activeGeneration === null && activeDirty !== null)
      || (activeDirty !== null
        && activeDirty > scope.cursor.appliedThroughSequence)
      || (provisionalGeneration === null && disposition !== null)
      || (provisionalGeneration !== null
        && disposition !== "ready" && disposition !== "blocked")
      || (activeGeneration === null && provisionalGeneration === null)
      || (
        provisionalGeneration !== null
        && (activeGeneration === null
          ? provisionalGeneration !== 1n
          : activeGeneration >= MAX_QUERY_GENERATION
            || provisionalGeneration !== activeGeneration + 1n)
      )
    ) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "evaluationWorkScan",
        "scanFactsInvalid",
        null,
      ));
    }
    return Object.freeze({
      queryKey,
      active: activeGeneration === null
        ? null
        : Object.freeze({
          generation: activeGeneration,
          dirtyThroughSequence: activeDirty,
        }),
      provisional: provisionalGeneration === null
        ? null
        : Object.freeze({
          generation: provisionalGeneration,
          evaluationDisposition: disposition === "ready"
            ? Object.freeze({ _tag: "ready" as const })
            : Object.freeze({
              _tag: "blocked" as const,
              reason: "terminalEvaluatorRefusal" as const,
              resetRequired: true as const,
            }),
        }),
    });
  });
}
