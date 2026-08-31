import {
  blockedPublicationAttemptDisposition,
  captureCanonicalQueryIdentity,
  captureCanonicalQueryKey,
  capturePublicationAttemptInstant,
  capturePublicationAttemptOrdinal,
  captureQueryPublicationArtifact,
  captureQueryResultDigest,
  makePendingQueryPublication,
  makeQueryPublicationIdentity,
  readyPublicationAttemptDisposition,
  uncertainPublicationAttemptDisposition,
  type CanonicalQueryKey,
  type DeliveredQueryPublication,
  type InFlightQueryPublication,
  type PendingQueryPublication,
  type PrecedingPublicationAttemptOutcome,
  type PublicationAttemptDisposition,
  type PublicationAttemptInstant,
  type PublicationAttemptOutcome,
  type PublicationAttemptOutcomeReceiptCore,
  type PublicationBlockReason,
  type QueryGeneration,
  type QueryPublicationIdentity,
} from "@flarex/query-sync/internal/kernel";
import type {
  PublicationLifecycleFacts,
  PublicationOwnerQueryFacts,
  QuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import { Result, Schema } from "effect";

import {
  captureDeploymentQuerySyncCanonicalValueResult,
  decodeDeploymentQuerySyncGenerationResult,
  decodeDeploymentQuerySyncRowShapeResult,
  decodeDeploymentQuerySyncSequenceResult,
  deploymentQuerySyncRowCodecError,
  type DeploymentQuerySyncRowCodecError,
  type DeploymentQuerySyncRowField,
} from "./RowCodec";

export interface EncodedDeploymentQuerySyncPublicationRow {
  readonly query_key: string;
  readonly generation: string;
  readonly query_identity: string;
  readonly completed_through_sequence: string;
  readonly result_digest: string;
  readonly content: string;
}

export type EncodedDeploymentQuerySyncPendingPublicationRow =
  EncodedDeploymentQuerySyncPublicationRow;

export interface EncodedDeploymentQuerySyncInFlightPublicationRow
  extends EncodedDeploymentQuerySyncPublicationRow {
  readonly singleton: 1;
}

export interface EncodedDeploymentQuerySyncPublicationStateRow {
  readonly singleton: 1;
  readonly attempt_ordinal: number | null;
  readonly first_attempt_at: string | null;
  readonly last_attempt_at: string | null;
  readonly attempt_disposition: "ready" | "uncertain" | "blocked" | null;
  readonly attempt_block_reason: PublicationBlockReason | null;
  readonly latest_delivered_query_key: string | null;
  readonly latest_delivered_generation: string | null;
  readonly latest_delivered_result_digest: string | null;
  readonly preceding_query_key: string | null;
  readonly preceding_generation: string | null;
  readonly preceding_result_digest: string | null;
  readonly preceding_attempt_ordinal: number | null;
  readonly preceding_outcome: PublicationAttemptOutcome | null;
  readonly preceding_receipt_tag: "recorded" | "blocked" | null;
  readonly preceding_next_attempt_ordinal: number | null;
  readonly preceding_next_disposition: "ready" | "uncertain" | null;
  readonly preceding_block_reason: PublicationBlockReason | null;
}

const publicationRowFields = {
  query_key: Schema.String,
  generation: Schema.String,
  query_identity: Schema.String,
  completed_through_sequence: Schema.String,
  result_digest: Schema.String,
  content: Schema.String,
} as const;

const RawPublicationRowSchema = Schema.Struct(publicationRowFields);

const RawInFlightPublicationRowSchema = Schema.Struct({
  singleton: Schema.Number,
  ...publicationRowFields,
});

const RawPublicationStateRowSchema = Schema.Struct({
  singleton: Schema.Number,
  attempt_ordinal: Schema.NullOr(Schema.Number),
  first_attempt_at: Schema.NullOr(Schema.String),
  last_attempt_at: Schema.NullOr(Schema.String),
  attempt_disposition: Schema.NullOr(Schema.String),
  attempt_block_reason: Schema.NullOr(Schema.String),
  latest_delivered_query_key: Schema.NullOr(Schema.String),
  latest_delivered_generation: Schema.NullOr(Schema.String),
  latest_delivered_result_digest: Schema.NullOr(Schema.String),
  preceding_query_key: Schema.NullOr(Schema.String),
  preceding_generation: Schema.NullOr(Schema.String),
  preceding_result_digest: Schema.NullOr(Schema.String),
  preceding_attempt_ordinal: Schema.NullOr(Schema.Number),
  preceding_outcome: Schema.NullOr(Schema.String),
  preceding_receipt_tag: Schema.NullOr(Schema.String),
  preceding_next_attempt_ordinal: Schema.NullOr(Schema.Number),
  preceding_next_disposition: Schema.NullOr(Schema.String),
  preceding_block_reason: Schema.NullOr(Schema.String),
});

const strictRowOptions = { onExcessProperty: "error" } as const;
const decodeRawPublicationRow = Schema.decodeUnknownResult(
  RawPublicationRowSchema,
  strictRowOptions,
);
const decodeRawInFlightPublicationRow = Schema.decodeUnknownResult(
  RawInFlightPublicationRowSchema,
  strictRowOptions,
);
const decodeRawPublicationStateRow = Schema.decodeUnknownResult(
  RawPublicationStateRowSchema,
  strictRowOptions,
);
const CANONICAL_NON_NEGATIVE_DECIMAL_TEXT = /^(?:0|[1-9][0-9]*)$/;

type RawPublicationRow = typeof RawPublicationRowSchema.Type;
type RawPublicationStateRow = typeof RawPublicationStateRowSchema.Type;

function publicationIdentity(
  scope: QuerySyncScopeFacts,
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
): QueryPublicationIdentity {
  return makeQueryPublicationIdentity({
    namespaceId: scope.cursor.namespaceId,
    syncModelId: scope.cursor.syncModelId,
    sourceEpoch: scope.cursor.sourceEpoch,
    queryKey,
    generation,
  });
}

function decodePublicationRow(
  rowKind: "pendingPublication" | "inFlightPublication",
  row: RawPublicationRow,
  scope: QuerySyncScopeFacts,
): Result.Result<PendingQueryPublication, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const queryKey = yield* captureDeploymentQuerySyncCanonicalValueResult(
      rowKind,
      "query_key",
      captureCanonicalQueryKey(row.query_key),
    );
    const generation = yield* decodeDeploymentQuerySyncGenerationResult(
      rowKind,
      "generation",
      row.generation,
    );
    const completedThroughSequence = yield*
      decodeDeploymentQuerySyncSequenceResult(
        rowKind,
        "completed_through_sequence",
        row.completed_through_sequence,
      );
    const resultDigest = yield* captureDeploymentQuerySyncCanonicalValueResult(
      rowKind,
      "result_digest",
      captureQueryResultDigest(row.result_digest),
    );
    const artifact = yield* captureQueryPublicationArtifact({
      content: row.content,
    }).pipe(Result.mapError(cause => deploymentQuerySyncRowCodecError(
      rowKind,
      "valueInvalid",
      "content",
      cause,
    )));
    const queryIdentity = yield* captureDeploymentQuerySyncCanonicalValueResult(
      rowKind,
      "query_identity",
      captureCanonicalQueryIdentity(row.query_identity),
    );
    return makePendingQueryPublication({
      identity: publicationIdentity(scope, queryKey, generation),
      queryIdentity,
      completedThroughSequence,
      resultDigest,
      content: artifact.content,
    });
  });
}

function decodeAttemptInstant(
  field: "first_attempt_at" | "last_attempt_at",
  value: string,
): Result.Result<PublicationAttemptInstant, DeploymentQuerySyncRowCodecError> {
  if (!CANONICAL_NON_NEGATIVE_DECIMAL_TEXT.test(value)) {
    return Result.fail(deploymentQuerySyncRowCodecError(
      "publicationState",
      "valueInvalid",
      field,
    ));
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || String(numeric) !== value) {
    return Result.fail(deploymentQuerySyncRowCodecError(
      "publicationState",
      "valueInvalid",
      field,
    ));
  }
  return captureDeploymentQuerySyncCanonicalValueResult(
    "publicationState",
    field,
    capturePublicationAttemptInstant(numeric),
  );
}

function decodeAttemptOrdinal(
  field: "attempt_ordinal" | "preceding_attempt_ordinal"
    | "preceding_next_attempt_ordinal",
  value: number,
) {
  return captureDeploymentQuerySyncCanonicalValueResult(
    "publicationState",
    field,
    capturePublicationAttemptOrdinal(value),
  );
}

function invalidPublicationStateGroup(
  field: DeploymentQuerySyncRowField | null = null,
): DeploymentQuerySyncRowCodecError {
  return deploymentQuerySyncRowCodecError(
    "publicationState",
    "publicationStateGroupInvalid",
    field,
  );
}

function decodeBlockReason(
  value: string,
  field: "attempt_block_reason" | "preceding_block_reason",
): Result.Result<PublicationBlockReason, DeploymentQuerySyncRowCodecError> {
  return value === "terminalPublisherRefusal"
      || value === "attemptLimitReached"
      || value === "ageLimitReached"
    ? Result.succeed(value)
    : Result.fail(invalidPublicationStateGroup(field));
}

function decodeDisposition(
  row: RawPublicationStateRow,
): Result.Result<PublicationAttemptDisposition | null, DeploymentQuerySyncRowCodecError> {
  if (row.attempt_disposition === null) {
    return row.attempt_block_reason === null
      ? Result.succeed(null)
      : Result.fail(invalidPublicationStateGroup("attempt_block_reason"));
  }
  switch (row.attempt_disposition) {
    case "ready":
      return row.attempt_block_reason === null
        ? Result.succeed(readyPublicationAttemptDisposition())
        : Result.fail(invalidPublicationStateGroup("attempt_block_reason"));
    case "uncertain":
      return row.attempt_block_reason === null
        ? Result.succeed(uncertainPublicationAttemptDisposition())
        : Result.fail(invalidPublicationStateGroup("attempt_block_reason"));
    case "blocked":
      return row.attempt_block_reason === null
        ? Result.fail(invalidPublicationStateGroup("attempt_block_reason"))
        : decodeBlockReason(
            row.attempt_block_reason,
            "attempt_block_reason",
          ).pipe(Result.map(blockedPublicationAttemptDisposition));
    default:
      return Result.fail(invalidPublicationStateGroup("attempt_disposition"));
  }
}

function decodeInFlight(
  row: RawPublicationStateRow,
  publication: PendingQueryPublication | null,
): Result.Result<InFlightQueryPublication | null, DeploymentQuerySyncRowCodecError> {
  const attemptOrdinal = row.attempt_ordinal;
  const firstAttemptAt = row.first_attempt_at;
  const lastAttemptAt = row.last_attempt_at;
  const attemptDisposition = row.attempt_disposition;
  const fields = [
    attemptOrdinal,
    firstAttemptAt,
    lastAttemptAt,
    attemptDisposition,
  ];
  const absent = fields.every(value => value === null);
  if (absent) {
    return publication === null && row.attempt_block_reason === null
      ? Result.succeed(null)
      : Result.fail(invalidPublicationStateGroup("attempt_ordinal"));
  }
  if (
    publication === null
    || attemptOrdinal === null
    || firstAttemptAt === null
    || lastAttemptAt === null
    || attemptDisposition === null
  ) {
    return Result.fail(invalidPublicationStateGroup("attempt_ordinal"));
  }
  return Result.gen(function* () {
    const disposition = yield* decodeDisposition(row);
    if (disposition === null) {
      return yield* Result.fail(invalidPublicationStateGroup(
        "attempt_disposition",
      ));
    }
    return Object.freeze({
      publication,
      attemptOrdinal: yield* decodeAttemptOrdinal(
        "attempt_ordinal",
        attemptOrdinal,
      ),
      firstAttemptAt: yield* decodeAttemptInstant(
        "first_attempt_at",
        firstAttemptAt,
      ),
      lastAttemptAt: yield* decodeAttemptInstant(
        "last_attempt_at",
        lastAttemptAt,
      ),
      disposition,
    });
  });
}

function decodeIdentityDigest(
  scope: QuerySyncScopeFacts,
  input: Readonly<{
    readonly queryKey: string | null;
    readonly generation: string | null;
    readonly resultDigest: string | null;
  }>,
  fields: Readonly<{
    readonly queryKey: "latest_delivered_query_key" | "preceding_query_key";
    readonly generation: "latest_delivered_generation" | "preceding_generation";
    readonly resultDigest:
      | "latest_delivered_result_digest"
      | "preceding_result_digest";
  }>,
): Result.Result<DeliveredQueryPublication | null, DeploymentQuerySyncRowCodecError> {
  const absent = input.queryKey === null
    && input.generation === null
    && input.resultDigest === null;
  if (absent) return Result.succeed(null);
  if (
    input.queryKey === null
    || input.generation === null
    || input.resultDigest === null
  ) {
    return Result.fail(invalidPublicationStateGroup(fields.queryKey));
  }
  const queryKeyText = input.queryKey;
  const generationText = input.generation;
  const resultDigestText = input.resultDigest;
  return Result.gen(function* () {
    const queryKey = yield* captureDeploymentQuerySyncCanonicalValueResult(
      "publicationState",
      fields.queryKey,
      captureCanonicalQueryKey(queryKeyText),
    );
    const generation = yield* decodeDeploymentQuerySyncGenerationResult(
      "publicationState",
      fields.generation,
      generationText,
    );
    return Object.freeze({
      identity: publicationIdentity(scope, queryKey, generation),
      resultDigest: yield* captureDeploymentQuerySyncCanonicalValueResult(
        "publicationState",
        fields.resultDigest,
        captureQueryResultDigest(resultDigestText),
      ),
    });
  });
}

function decodeOutcome(value: string): Result.Result<
  PublicationAttemptOutcome,
  DeploymentQuerySyncRowCodecError
> {
  return value === "knownNotAppended"
      || value === "outcomeUnknown"
      || value === "terminalRefusal"
    ? Result.succeed(value)
    : Result.fail(invalidPublicationStateGroup("preceding_outcome"));
}

function decodeOutcomeReceipt(
  row: RawPublicationStateRow,
): Result.Result<
  PublicationAttemptOutcomeReceiptCore,
  DeploymentQuerySyncRowCodecError
> {
  if (row.preceding_receipt_tag === "recorded") {
    const nextDisposition = row.preceding_next_disposition;
    if (
      row.preceding_next_attempt_ordinal === null
      || (
        nextDisposition !== "ready"
        && nextDisposition !== "uncertain"
      )
      || row.preceding_block_reason !== null
    ) {
      return Result.fail(invalidPublicationStateGroup("preceding_receipt_tag"));
    }
    return decodeAttemptOrdinal(
      "preceding_next_attempt_ordinal",
      row.preceding_next_attempt_ordinal,
    ).pipe(Result.map(nextAttemptOrdinal => Object.freeze({
      _tag: "recorded" as const,
      nextAttemptOrdinal,
      nextDisposition,
    })));
  }
  if (row.preceding_receipt_tag === "blocked") {
    if (
      row.preceding_next_attempt_ordinal !== null
      || row.preceding_next_disposition !== null
      || row.preceding_block_reason === null
    ) {
      return Result.fail(invalidPublicationStateGroup("preceding_receipt_tag"));
    }
    return decodeBlockReason(
      row.preceding_block_reason,
      "preceding_block_reason",
    ).pipe(Result.map(reason => Object.freeze({
      _tag: "blocked" as const,
      reason,
      resetRequired: true as const,
    })));
  }
  return Result.fail(invalidPublicationStateGroup("preceding_receipt_tag"));
}

function decodePrecedingOutcome(
  scope: QuerySyncScopeFacts,
  row: RawPublicationStateRow,
): Result.Result<
  PrecedingPublicationAttemptOutcome | null,
  DeploymentQuerySyncRowCodecError
> {
  const fields = [
    row.preceding_query_key,
    row.preceding_generation,
    row.preceding_result_digest,
    row.preceding_attempt_ordinal,
    row.preceding_outcome,
    row.preceding_receipt_tag,
    row.preceding_next_attempt_ordinal,
    row.preceding_next_disposition,
    row.preceding_block_reason,
  ];
  if (fields.every(value => value === null)) {
    return Result.succeed(null);
  }
  const queryKey = row.preceding_query_key;
  const generation = row.preceding_generation;
  const resultDigest = row.preceding_result_digest;
  const attemptOrdinal = row.preceding_attempt_ordinal;
  const outcome = row.preceding_outcome;
  const receiptTag = row.preceding_receipt_tag;
  if (
    queryKey === null
    || generation === null
    || resultDigest === null
    || attemptOrdinal === null
    || outcome === null
    || receiptTag === null
  ) {
    return Result.fail(invalidPublicationStateGroup("preceding_query_key"));
  }
  return Result.gen(function* () {
    const identityDigest = yield* decodeIdentityDigest(scope, {
      queryKey,
      generation,
      resultDigest,
    }, {
      queryKey: "preceding_query_key",
      generation: "preceding_generation",
      resultDigest: "preceding_result_digest",
    });
    if (identityDigest === null) {
      return yield* Result.fail(invalidPublicationStateGroup(
        "preceding_query_key",
      ));
    }
    return Object.freeze({
      identity: identityDigest.identity,
      resultDigest: identityDigest.resultDigest,
      attemptOrdinal: yield* decodeAttemptOrdinal(
        "preceding_attempt_ordinal",
        attemptOrdinal,
      ),
      outcome: yield* decodeOutcome(outcome),
      receipt: yield* decodeOutcomeReceipt(row),
    });
  });
}

export function decodeDeploymentQuerySyncPendingPublicationRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
  query: PublicationOwnerQueryFacts,
): Result.Result<PendingQueryPublication, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const row = yield* decodeDeploymentQuerySyncRowShapeResult(
      "pendingPublication",
      decodeRawPublicationRow(input),
    );
    const publication = yield* decodePublicationRow(
      "pendingPublication",
      row,
      scope,
    );
    const generation = publication.identity.generation;
    const active = query.active;
    const completion = query.currentCompletion;
    const sameGenerationValid = active !== null
      && generation === active.generation
      && completion !== null
      && completion.publicationDisposition._tag === "pending"
      && completion.identity.generation === generation
      && publication.completedThroughSequence
        === completion.refreshedThroughSequence
      && publication.resultDigest === completion.resultDigest;
    if (
      publication.identity.queryKey !== query.descriptor.queryKey
      || publication.queryIdentity !== query.descriptor.queryIdentity
      || active === null
      || generation > active.generation
      || publication.completedThroughSequence
        > scope.cursor.appliedThroughSequence
      || publication.completedThroughSequence > active.freshThroughSequence
      || publication.resultDigest !== active.resultDigest
      || (generation === active.generation && !sameGenerationValid)
    ) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "pendingPublication",
        "pendingPublicationFactsInvalid",
        null,
      ));
    }
    return publication;
  });
}

export function decodeDeploymentQuerySyncInFlightPublicationRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
): Result.Result<PendingQueryPublication, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const row = yield* decodeDeploymentQuerySyncRowShapeResult(
      "inFlightPublication",
      decodeRawInFlightPublicationRow(input),
    );
    if (row.singleton !== 1) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "inFlightPublication",
        "valueInvalid",
        "singleton",
      ));
    }
    const publication = yield* decodePublicationRow(
      "inFlightPublication",
      row,
      scope,
    );
    if (
      publication.completedThroughSequence
        > scope.cursor.appliedThroughSequence
    ) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "inFlightPublication",
        "pendingPublicationFactsInvalid",
        "completed_through_sequence",
      ));
    }
    return publication;
  });
}

export function decodeDeploymentQuerySyncPublicationStateRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
  inFlightPublication: PendingQueryPublication | null,
): Result.Result<PublicationLifecycleFacts, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const row = yield* decodeDeploymentQuerySyncRowShapeResult(
      "publicationState",
      decodeRawPublicationStateRow(input),
    );
    if (row.singleton !== 1) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "publicationState",
        "valueInvalid",
        "singleton",
      ));
    }
    const latestDelivered = yield* decodeIdentityDigest(scope, {
      queryKey: row.latest_delivered_query_key,
      generation: row.latest_delivered_generation,
      resultDigest: row.latest_delivered_result_digest,
    }, {
      queryKey: "latest_delivered_query_key",
      generation: "latest_delivered_generation",
      resultDigest: "latest_delivered_result_digest",
    });
    return Object.freeze({
      inFlight: yield* decodeInFlight(row, inFlightPublication),
      latestDelivered,
      precedingAttemptOutcome: yield* decodePrecedingOutcome(scope, row),
    });
  });
}

export function encodeDeploymentQuerySyncPendingPublicationRow(
  publication: PendingQueryPublication,
): EncodedDeploymentQuerySyncPendingPublicationRow {
  return encodePublication(publication);
}

export function encodeDeploymentQuerySyncInFlightPublicationRow(
  inFlight: InFlightQueryPublication,
): EncodedDeploymentQuerySyncInFlightPublicationRow {
  return Object.freeze({
    singleton: 1,
    ...encodePublication(inFlight.publication),
  });
}

export function encodeDeploymentQuerySyncPublicationStateRow(
  lifecycle: PublicationLifecycleFacts,
): EncodedDeploymentQuerySyncPublicationStateRow {
  const inFlight = lifecycle.inFlight;
  const latest = lifecycle.latestDelivered;
  const preceding = lifecycle.precedingAttemptOutcome;
  const receipt = preceding?.receipt ?? null;
  return Object.freeze({
    singleton: 1,
    attempt_ordinal: inFlight?.attemptOrdinal ?? null,
    first_attempt_at: inFlight?.firstAttemptAt.toString() ?? null,
    last_attempt_at: inFlight?.lastAttemptAt.toString() ?? null,
    attempt_disposition: inFlight?.disposition._tag ?? null,
    attempt_block_reason: inFlight?.disposition._tag === "blocked"
      ? inFlight.disposition.reason
      : null,
    latest_delivered_query_key: latest?.identity.queryKey ?? null,
    latest_delivered_generation: latest?.identity.generation.toString() ?? null,
    latest_delivered_result_digest: latest?.resultDigest ?? null,
    preceding_query_key: preceding?.identity.queryKey ?? null,
    preceding_generation: preceding?.identity.generation.toString() ?? null,
    preceding_result_digest: preceding?.resultDigest ?? null,
    preceding_attempt_ordinal: preceding?.attemptOrdinal ?? null,
    preceding_outcome: preceding?.outcome ?? null,
    preceding_receipt_tag: receipt?._tag ?? null,
    preceding_next_attempt_ordinal: receipt?._tag === "recorded"
      ? receipt.nextAttemptOrdinal
      : null,
    preceding_next_disposition: receipt?._tag === "recorded"
      ? receipt.nextDisposition
      : null,
    preceding_block_reason: receipt?._tag === "blocked"
      ? receipt.reason
      : null,
  });
}

function encodePublication(
  publication: PendingQueryPublication,
): EncodedDeploymentQuerySyncPublicationRow {
  return Object.freeze({
    query_key: publication.identity.queryKey,
    generation: publication.identity.generation.toString(),
    query_identity: publication.queryIdentity,
    completed_through_sequence:
      publication.completedThroughSequence.toString(),
    result_digest: publication.resultDigest,
    content: publication.content,
  });
}
