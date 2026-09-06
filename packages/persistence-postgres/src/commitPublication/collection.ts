import { Effect, Result } from "effect";
import { measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import { captureReceiptCandidates } from "./policy";
import {
  publicationError,
  MAX_MUTATION_RECEIPTS,
  MAX_RECEIPT_IDENTITY_BYTES,
} from "./model";
import type {
  MutationRecorder,
  PublicationCollectionInput,
  PublicationOwner,
  PublicationSeal,
  RelationalMutationAttempt,
  RelationalMutationReceipt,
  ReceiptObservation,
  PublicationAdmissionError,
  ScalarMutationOperation,
} from "./model";
import type { RelationalPhysicalTable } from "../relationalSchema/physical/model";

/** One dynamically composed transaction owner; no family registry or publication writer. */
export function makePublicationCollection(
  input: PublicationCollectionInput,
): Readonly<{ recorder: MutationRecorder; owner: PublicationOwner }> {
  const pins = Object.freeze({ ...input.pins });
  const { canRecord, canSeal, onFailure, charge, beforeComplete } = input;
  const attempts = new Map<
    RelationalMutationAttempt,
    {
      readonly observation: Omit<ReceiptObservation, "affectedRows">;
      receipt?: RelationalMutationReceipt;
    }
  >();
  const records = new Map<RelationalMutationReceipt, ReceiptObservation>();
  let phase: "open" | "sealed" | "consumed" | "closed" = "open";
  let failed = false;
  let retainedBytes = 0;
  let currentSeal: PublicationSeal | undefined;
  let marked = false;
  const guard = <Value>(
    work: Effect.Effect<Value, PublicationAdmissionError>,
  ) =>
    work.pipe(
      Effect.tapCause(() =>
        Effect.sync(() => {
          failed = true;
          onFailure();
        }),
      ),
    );
  const recorder: MutationRecorder = Object.freeze({
    reserve: Effect.fn("PublicationCollection.reserve")(
      (
        table: RelationalPhysicalTable,
        operation: ScalarMutationOperation,
        key: string,
      ) =>
        guard(
          Effect.gen(function* () {
            if (phase !== "open" || failed || !canRecord())
              return yield* Effect.fail(
                publicationError("receiptAdmissionClosed"),
              );
            if (
              !pins.admission.installation.plan.plan.physicalLayout.frame.tables.includes(
                table,
              ) ||
              !["insert", "update", "delete"].includes(operation) ||
              typeof key !== "string" ||
              key.includes("\0") ||
              /[\uD800-\uDFFF]/u.test(key)
            )
              return yield* Effect.fail(
                publicationError("invalidReceiptAuthority"),
              );
            if (attempts.size >= MAX_MUTATION_RECEIPTS)
              return yield* Effect.fail(publicationError("limitExceeded"));
            const observation = Object.freeze({
              ordinal: attempts.size + 1,
              operation,
              table: table.identity,
              key,
            });
            const measured = measureCanonicalJsonUtf8Bytes(
              { ...observation, affectedRows: 1 },
              MAX_RECEIPT_IDENTITY_BYTES - retainedBytes,
            );
            if (measured.kind !== "success")
              return yield* Effect.fail(publicationError("limitExceeded"));
            yield* Effect.fromResult(charge(measured.bytes));
            // SAFETY: the opaque token is authenticated by this exact transaction's map.
            const attempt = Object.freeze({}) as RelationalMutationAttempt;
            attempts.set(attempt, { observation });
            retainedBytes += measured.bytes;
            return attempt;
          }),
        ),
    ),
    complete: Effect.fn("PublicationCollection.complete")(
      (attempt: RelationalMutationAttempt, returnedKeys: readonly string[]) =>
        guard(
          Effect.gen(function* () {
            if (phase !== "open" || failed || !canRecord())
              return yield* Effect.fail(
                publicationError("receiptAdmissionClosed"),
              );
            const entry = attempts.get(attempt);
            if (entry === undefined || entry.receipt !== undefined)
              return yield* Effect.fail(
                publicationError("invalidReceiptAuthority"),
              );
            if (
              returnedKeys.length > 1 ||
              (entry.observation.operation === "insert" &&
                returnedKeys.length !== 1) ||
              returnedKeys.some((key) => key !== entry.observation.key)
            )
              return yield* Effect.fail(
                publicationError("invalidReceiptAuthority"),
              );
            if (beforeComplete !== undefined)
              yield* beforeComplete(entry.observation.ordinal);
            if (
              phase !== "open" ||
              failed ||
              !canRecord() ||
              entry.receipt !== undefined
            )
              return yield* Effect.fail(
                publicationError("receiptAdmissionClosed"),
              );
            // SAFETY: receipt identity and evidence exist only in this transaction's owned map.
            const receipt = Object.freeze({}) as RelationalMutationReceipt;
            records.set(
              receipt,
              Object.freeze({
                ...entry.observation,
                affectedRows: returnedKeys.length === 0 ? 0 : 1,
              }),
            );
            entry.receipt = receipt;
            return receipt;
          }),
        ),
    ),
  });
  // Pure authentication reads owned state; failures are latched by the operation boundary.
  const authenticate = (
    seal: PublicationSeal,
    candidates: readonly RelationalMutationReceipt[] = [...records.keys()],
  ): Result.Result<readonly ReceiptObservation[], PublicationAdmissionError> =>
    Result.gen(function* () {
      if (phase !== "sealed" || failed)
        return yield* Result.fail(publicationError("receiptAdmissionClosed"));
      if (seal !== currentSeal)
        return yield* Result.fail(publicationError("invalidReceiptAuthority"));
      const captured = yield* captureReceiptCandidates(candidates);
      if (
        attempts.size !== records.size ||
        captured.length !== records.size ||
        marked !== attempts.size > 0
      )
        return yield* Result.fail(publicationError("incompleteReceiptSet"));
      const observations: ReceiptObservation[] = [];
      const expected = [...records.entries()];
      for (const [index, receipt] of captured.entries()) {
        const entry = expected[index];
        const observation = entry?.[1];
        if (
          observation === undefined ||
          receipt !== entry?.[0] ||
          observation.ordinal !== index + 1
        )
          return yield* Result.fail(
            publicationError("invalidReceiptAuthority"),
          );
        observations.push(observation);
      }
      return Object.freeze(observations);
    });
  const owner: PublicationOwner = Object.freeze({
    seal: Effect.fn("PublicationCollection.seal")(
      (mutationAttempted: boolean) =>
        guard(
          Effect.gen(function* () {
            if (phase !== "open" || failed || !canSeal())
              return yield* Effect.fail(
                publicationError("receiptAdmissionClosed"),
              );
            marked = mutationAttempted;
            phase = "sealed";
            // SAFETY: this exact seal identity is retained only by its issuing owner.
            currentSeal = Object.freeze({}) as PublicationSeal;
            return currentSeal;
          }),
        ),
    ),
    inspect: Effect.fn("PublicationCollection.inspect")(
      (
        seal: PublicationSeal,
        candidates?: readonly RelationalMutationReceipt[],
      ) =>
        guard(
          Effect.suspend(() =>
            Effect.fromResult(authenticate(seal, candidates)),
          ),
        ),
    ),
    admit: Effect.fn("PublicationCollection.admit")(
      (
        seal: PublicationSeal,
        candidates?: readonly RelationalMutationReceipt[],
      ) =>
        guard(
          Effect.gen(function* () {
            const observations = yield* Effect.fromResult(
              authenticate(seal, candidates),
            );
            phase = "consumed";
            if (observations.length !== 0 || marked)
              return yield* Effect.fail(
                publicationError("unadmittedFinalization"),
              );
          }),
        ),
    ),
    close: Effect.sync(() => {
      phase = "closed";
      attempts.clear();
      records.clear();
      currentSeal = undefined;
      retainedBytes = 0;
    }),
    receipts: () => Object.freeze([...records.keys()]),
  });
  return Object.freeze({ recorder, owner });
}
