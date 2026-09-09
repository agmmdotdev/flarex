import { and, eq, getTableColumns, sql, type SQLWrapper } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../../databaseTimestamp";
import type { PrivateCanonicalValueSnapshot } from "../privateCanonicalValue";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../installation/storedMetadataRestoration";
import {
  captureBindingValue,
  restoreBindingValue,
  isDataBindingSetFrame,
  isDataBindingHeadFrame,
  isDataBindingActivationFrame,
  sameBindingValue,
} from "./canonical";
import { bindingError, type DataBindingError } from "./errors";
import {
  MAX_BINDING_BYTES,
  MAX_COMMERCE_BINDINGS,
  physicalBindings,
  type DataBindingSetFrame,
  type DataBindingActivationRequest,
  type PhysicalBindingSlot,
} from "./model";
import {
  fxSystemDataBindingCandidates as candidates,
  fxSystemDataBindingPhysicalLanes as lanes,
  fxSystemDataBindingActivations as activations,
  fxSystemDataBindingHeads as heads,
} from "./schema";

export type StoredBindingValue<Frame extends JsonObject> = Readonly<{
  frame: Frame;
  sha256: string;
}>;
export type BindingLocation = Readonly<{
  scopeId: string;
  storageGeneration: string;
}>;
export type VerifiedBindingLane = Readonly<{
  slot: PhysicalBindingSlot;
  availability: RestoredFrameworkSchemaAvailabilityHead;
}>;

export function bindingStatement<Value>(
  statement: PromiseLike<Value>,
): Effect.Effect<Value, DataBindingError> {
  return runDrizzleStatementEffect(statement, (cause) =>
    bindingError("resourceFailure", cause),
  );
}
function boundedBytes(column: SQLWrapper) {
  return sql<Uint8Array | null>`case when octet_length(${column}) between 1 and ${sql.raw(String(MAX_BINDING_BYTES))} then ${column} else null end`;
}
const decode = Effect.fn("DataBindingRepository.decode")(function* <
  Frame extends JsonObject,
>(
  row: Readonly<{
    canonicalBytes: unknown;
    canonicalByteLength: number;
    sha256: string;
  }>,
  format: string,
  guard: (input: unknown) => input is Frame,
): Effect.fn.Return<StoredBindingValue<Frame>, DataBindingError> {
  const frame = yield* restoreBindingValue(
    row.canonicalBytes,
    row.sha256,
    format,
    guard,
  );
  if (
    !(row.canonicalBytes instanceof Uint8Array) ||
    row.canonicalBytes.byteLength !== row.canonicalByteLength
  ) {
    return yield* Effect.fail(bindingError("storedCorruption"));
  }
  return Object.freeze({ frame, sha256: row.sha256 });
});
export const readBindingCandidate = Effect.fn(
  "DataBindingRepository.readCandidate",
)(function* (
  tx: FlarexMetadataTransaction,
  location: BindingLocation,
  digest: string,
) {
  const rows = yield* bindingStatement(
    tx
      .select({
        ...getTableColumns(candidates),
        canonicalBytes: boundedBytes(candidates.canonicalBytes),
      })
      .from(candidates)
      .where(
        and(
          eq(candidates.scopeId, location.scopeId),
          eq(candidates.storageGeneration, location.storageGeneration),
          eq(candidates.sha256, digest),
        ),
      )
      .limit(1),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  const restored = yield* decode(
    row,
    "flarex.data-binding-set",
    isDataBindingSetFrame,
  );
  if (
    restored.frame.application.scopeId !== location.scopeId ||
    restored.frame.application.storageGeneration !== location.storageGeneration
  ) {
    return yield* Effect.fail(bindingError("storedCorruption"));
  }
  const storedLanes = yield* bindingStatement(
    tx
      .select()
      .from(lanes)
      .where(
        and(
          eq(lanes.scopeId, location.scopeId),
          eq(lanes.storageGeneration, location.storageGeneration),
          eq(lanes.candidateSha256, digest),
        ),
      )
      .limit(MAX_COMMERCE_BINDINGS + 2),
  );
  const expected = physicalBindings(restored.frame);
  if (storedLanes.length !== expected.length)
    return yield* Effect.fail(bindingError("storedCorruption"));
  for (const { slot, binding } of expected) {
    const lane = storedLanes.find((value) => value.slot === slot &&
      encodeBytesToLowercaseHex(value.installationSha256) === binding.installation.installationSha256);
    if (
      lane === undefined ||
      encodeBytesToLowercaseHex(lane.installationSha256) !==
        binding.installation.installationSha256 ||
      encodeBytesToLowercaseHex(lane.installationReceiptSha256) !==
        binding.installationReceiptSha256 ||
      encodeBytesToLowercaseHex(lane.readinessSha256) !==
        binding.readinessSha256 ||
      lane.availabilitySequence.toString() !== binding.availabilitySequence ||
      lane.availabilityStatus !== "ready" ||
      encodeBytesToLowercaseHex(lane.availabilityHistorySha256) !==
        binding.availabilityHistorySha256
    ) {
      return yield* Effect.fail(bindingError("storedCorruption"));
    }
  }
  return Option.some(restored);
});
export const storeBindingCandidate = Effect.fn(
  "DataBindingRepository.storeCandidate",
)(function* (
  tx: FlarexMetadataTransaction,
  candidate: PrivateCanonicalValueSnapshot<DataBindingSetFrame>,
  verified: readonly VerifiedBindingLane[],
) {
  const location = candidate.frame.application;
  const inserted = yield* bindingStatement(
    tx
      .insert(candidates)
      .values({
        scopeId: location.scopeId,
        storageGeneration: location.storageGeneration,
        sha256: candidate.sha256Hex,
        canonicalBytes: candidate.copyCanonicalBytes(),
        canonicalByteLength: candidate.canonicalByteLength,
      })
      .onConflictDoNothing()
      .returning({ sha256: candidates.sha256 }),
  );
  // Existing candidates must already have their entire immutable sidecar set.
  // Only an insertion in this transaction may initialize those rows.
  for (const { slot, availability } of inserted.length === 1 ? verified : []) {
    yield* bindingStatement(
      tx
        .insert(lanes)
        .values({
          scopeId: location.scopeId,
          storageGeneration: location.storageGeneration,
          candidateSha256: candidate.sha256Hex,
          slot,
          installationStorageId: availability.installation.storageId,
          installationSha256: yield* hexBytes(
            availability.installation.installation.frame.identity
              .installationSha256,
          ),
          installationReceiptSha256: yield* hexBytes(
            availability.installation.installation.sha256,
          ),
          readinessStorageId: availability.readiness.storageId,
          readinessSha256: yield* hexBytes(
            availability.readiness.readiness.sha256,
          ),
          availabilityHistoryStorageId: availability.history.storageId,
          availabilitySequence: BigInt(
            availability.head.frame.availabilitySequence,
          ),
          availabilityStatus: "ready",
          availabilityHistorySha256: yield* hexBytes(
            availability.history.history.sha256,
          ),
        })
        .onConflictDoNothing(),
    );
  }
  const stored = yield* readBindingCandidate(tx, location, candidate.sha256Hex);
  if (
    Option.isNone(stored) ||
    !sameBindingValue(stored.value.frame, candidate.frame)
  )
    return yield* Effect.fail(bindingError("storedCorruption"));
  return stored.value;
});
export const readBindingActivation = Effect.fn(
  "DataBindingRepository.readActivation",
)(function* (
  tx: FlarexMetadataTransaction,
  scopeId: string,
  requestId: string,
) {
  const rows = yield* bindingStatement(
    tx
      .select({
        ...getTableColumns(activations),
        canonicalBytes: boundedBytes(activations.canonicalBytes),
      })
      .from(activations)
      .where(
        and(
          eq(activations.scopeId, scopeId),
          eq(activations.requestId, requestId),
        ),
      )
      .limit(1),
  );
  const row = rows[0];
  return row === undefined
    ? Option.none()
    : Option.some(yield* decodeActivationRow(row));
});
const decodeActivationRow = Effect.fn("DataBindingRepository.decodeActivation")(
  function* (
    row: Omit<typeof activations.$inferSelect, "canonicalBytes"> & {
      canonicalBytes: Uint8Array | null;
    },
  ) {
    const restored = yield* decode(
      row,
      "flarex.data-binding-activation",
      isDataBindingActivationFrame,
    );
    const request = restored.frame.request;
    if (
      request.scopeId !== row.scopeId ||
      request.storageGeneration !== row.storageGeneration ||
      request.requestId !== row.requestId ||
      request.candidateSha256 !== row.candidateSha256 ||
      restored.frame.sequence !== row.sequence.toString()
    ) {
      return yield* Effect.fail(bindingError("storedCorruption"));
    }
    return restored;
  },
);
export const readBindingHead = Effect.fn("DataBindingRepository.readHead")(
  function* (
    tx: FlarexMetadataTransaction,
    location: BindingLocation,
    lock: boolean,
  ) {
    const query = tx
      .select({
        ...getTableColumns(heads),
        canonicalBytes: boundedBytes(heads.canonicalBytes),
      })
      .from(heads)
      .where(
        and(
          eq(heads.scopeId, location.scopeId),
          eq(heads.storageGeneration, location.storageGeneration),
        ),
      )
      .limit(1);
    const rows = yield* bindingStatement(lock ? query.for("update") : query);
    const row = rows[0];
    if (row === undefined) return Option.none();
    const head = yield* decode(
      row,
      "flarex.data-binding-head",
      isDataBindingHeadFrame,
    );
    if (
      head.frame.scopeId !== location.scopeId ||
      head.frame.storageGeneration !== location.storageGeneration ||
      head.frame.sequence !== row.sequence.toString() ||
      head.frame.candidateSha256 !== row.candidateSha256 ||
      head.frame.activationSha256 !== row.activationSha256
    )
      return yield* Effect.fail(bindingError("storedCorruption"));
    const records = yield* bindingStatement(
      tx
        .select({
          ...getTableColumns(activations),
          canonicalBytes: boundedBytes(activations.canonicalBytes),
        })
        .from(activations)
        .where(
          and(
            eq(activations.scopeId, location.scopeId),
            eq(activations.storageGeneration, location.storageGeneration),
            eq(activations.sequence, row.sequence),
          ),
        )
        .limit(1),
    );
    const record = records[0];
    if (record === undefined)
      return yield* Effect.fail(bindingError("storedCorruption"));
    const activation = yield* decodeActivationRow(record);
    if (
      activation.sha256 !== head.frame.activationSha256 ||
      activation.frame.request.candidateSha256 !== head.frame.candidateSha256
    ) {
      return yield* Effect.fail(bindingError("storedCorruption"));
    }
    return Option.some(head);
  },
);
export const writeBindingActivation = Effect.fn(
  "DataBindingRepository.writeActivation",
)(function* (
  tx: FlarexMetadataTransaction,
  request: DataBindingActivationRequest,
) {
  const times = yield* bindingStatement(
    tx
      .select({ now: sql<unknown>`transaction_timestamp()` })
      .from(candidates)
      .where(
        and(
          eq(candidates.scopeId, request.scopeId),
          eq(candidates.storageGeneration, request.storageGeneration),
          eq(candidates.sha256, request.candidateSha256),
        ),
      )
      .limit(1),
  );
  const now = databaseTimestampFromUnknown(times[0]?.now);
  if (now === null) return yield* Effect.fail(bindingError("storedCorruption"));
  const sequence =
    request.expectedHead === null
      ? 1n
      : BigInt(request.expectedHead.sequence) + 1n;
  const activation = yield* captureBindingValue(
    {
      format: "flarex.data-binding-activation",
      version: 1,
      request,
      sequence: sequence.toString(),
      activatedAt: now.toISOString(),
    },
    isDataBindingActivationFrame,
  );
  const head = yield* captureBindingValue(
    {
      format: "flarex.data-binding-head",
      version: 1,
      scopeId: request.scopeId,
      storageGeneration: request.storageGeneration,
      sequence: sequence.toString(),
      candidateSha256: request.candidateSha256,
      activationSha256: activation.sha256Hex,
    },
    isDataBindingHeadFrame,
  );
  yield* bindingStatement(
    tx.insert(activations).values({
      scopeId: request.scopeId,
      storageGeneration: request.storageGeneration,
      requestId: request.requestId,
      sequence,
      candidateSha256: request.candidateSha256,
      sha256: activation.sha256Hex,
      canonicalBytes: activation.copyCanonicalBytes(),
      canonicalByteLength: activation.canonicalByteLength,
    }),
  );
  const values = {
    scopeId: request.scopeId,
    storageGeneration: request.storageGeneration,
    sequence,
    candidateSha256: request.candidateSha256,
    activationSha256: activation.sha256Hex,
    sha256: head.sha256Hex,
    canonicalBytes: head.copyCanonicalBytes(),
    canonicalByteLength: head.canonicalByteLength,
  };
  yield* bindingStatement(
    tx
      .insert(heads)
      .values(values)
      .onConflictDoUpdate({
        target: [heads.scopeId, heads.storageGeneration],
        set: values,
      }),
  );
  return Object.freeze({
    frame: activation.frame,
    sha256: activation.sha256Hex,
  });
});

const hexBytes = Effect.fn("DataBindingRepository.decodeDigest")(
  (value: string) =>
    Effect.fromResult(Encoding.decodeHex(value)).pipe(
      Effect.mapError((cause) => bindingError("storedCorruption", cause)),
    ),
);
