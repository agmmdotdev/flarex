import { and, eq, getTableColumns, sql, type SQLWrapper } from "drizzle-orm";
import { Effect, Encoding, Option, Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../../databaseTimestamp";
import { readStandaloneReadSnapshot } from "../../standaloneReadSnapshot";
import { hasProtectedMetadataFinalGuardScope, registerProtectedMetadataFinalGuard,
  authenticateProtectedTargetMetadataSnapshot,
  type ProtectedTargetMetadataEvidence } from "../../preparedMetadataEpoch";
import type { captureHostPreparationLifetime } from "../../preparedHostRuntime";
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
  type DataBindingHeadFrame,
  type PhysicalBindingSlot,
} from "./model";
import type { StrongReferenceActivationProjection } from "./strongReferenceProjection";
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

declare const preparedSelectedStructureBrand: unique symbol;
export interface PreparedBindingSelectedStructure { readonly [preparedSelectedStructureBrand]: true }
interface PreparedSelectedStructureState {
  readonly location: BindingLocation;
  readonly protection: ProtectedTargetMetadataEvidence;
  readonly lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
  structure?: Readonly<{ candidate: StoredBindingValue<DataBindingSetFrame>;
    activation: Effect.Success<ReturnType<typeof decodeActivationRow>> }>;
}
const preparedSelectedStructures = new WeakMap<object, PreparedSelectedStructureState>();

/** Issued by connected source preparation, with nominal Application lineage.
 * The first read still authenticates activation, candidate and complete lanes. */
export function prepareBindingSelectedStructure(location: BindingLocation,
  protection: ProtectedTargetMetadataEvidence, lifetime: PreparedSelectedStructureState["lifetime"]): PreparedBindingSelectedStructure {
  // SAFETY: only the private registry recognizes the inert issued handle.
  const token = Object.freeze({}) as PreparedBindingSelectedStructure;
  preparedSelectedStructures.set(token, { location: Object.freeze({ ...location }), protection, lifetime });
  return token;
}
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
function singleCanonicalBytes(column: SQLWrapper) {
  // ROW_NUMBER without ordering is streamable; LIMIT still bounds the rows
  // fetched even if corrupt sidecars exceed the complete-set ceiling.
  return sql<Uint8Array | null>`case when row_number() over () = 1 then ${boundedBytes(column)} else null end`;
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
        candidate: {
          ...getTableColumns(candidates),
          // The bounded one-to-many read transports the full frame once,
          // rather than repeating up to MAX_BINDING_BYTES for every lane.
          canonicalBytes: singleCanonicalBytes(candidates.canonicalBytes),
        },
        lane: getTableColumns(lanes),
      })
      .from(candidates)
      .leftJoin(lanes, and(
        eq(lanes.scopeId, candidates.scopeId),
        eq(lanes.storageGeneration, candidates.storageGeneration),
        eq(lanes.candidateSha256, candidates.sha256),
      ))
      .where(
        and(
          eq(candidates.scopeId, location.scopeId),
          eq(candidates.storageGeneration, location.storageGeneration),
          eq(candidates.sha256, digest),
        ),
      )
      // At most nine expected lanes; the extra row preserves excess detection.
      .limit(MAX_COMMERCE_BINDINGS + 2),
  );
  const row = (rows.find((value) => value.candidate.canonicalBytes !== null) ?? rows[0])
    ?.candidate;
  if (row === undefined) return Option.none();
  const storedLanes = rows.flatMap((value) => value.lane === null ? [] : [value.lane]);
  return Option.some(yield* decodeCandidateWithLanes(row, storedLanes, location));
});
const decodeCandidateWithLanes = Effect.fn("DataBindingRepository.decodeCandidateWithLanes")(
function* (
  row: Omit<typeof candidates.$inferSelect, "canonicalBytes"> & {
    readonly canonicalBytes: Uint8Array | null;
  },
  storedLanes: ReadonlyArray<typeof lanes.$inferSelect>,
  location: BindingLocation,
) {
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
  return restored;
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
const readBindingHeadRecord = Effect.fn("DataBindingRepository.readHeadRecord")(
  function* (
    tx: FlarexMetadataTransaction,
    location: BindingLocation,
    lock: "none" | "share" | "update",
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
    const rows = yield* bindingStatement(lock === "none" ? query : query.for(lock));
    const row = rows[0];
    if (row === undefined) return Option.none();
    return Option.some(yield* restoreBindingHeadRecord(row, location));
  },
);

const restoreBindingHeadRecord = Effect.fn("DataBindingRepository.restoreHeadRecord")(
  function* (row: Readonly<Omit<typeof heads.$inferSelect, "canonicalBytes"> & { canonicalBytes: Uint8Array | null }>,
    location: BindingLocation) {
    const head = yield* decode(
      row,
      "flarex.data-binding-head",
      isDataBindingHeadFrame,
    );
    if (
      row.scopeId !== location.scopeId || row.storageGeneration !== location.storageGeneration ||
      head.frame.scopeId !== location.scopeId ||
      head.frame.storageGeneration !== location.storageGeneration ||
      head.frame.sequence !== row.sequence.toString() ||
      head.frame.candidateSha256 !== row.candidateSha256 ||
      head.frame.activationSha256 !== row.activationSha256
    )
      return yield* Effect.fail(bindingError("storedCorruption"));
    return head;
  },
);
export const readBindingHead = Effect.fn("DataBindingRepository.readHead")(
  function* (tx: FlarexMetadataTransaction, location: BindingLocation,
    lock: "none" | "share" | "update") {
    const head = yield* readBindingHeadRecord(tx, location, lock);
    if (Option.isNone(head)) return head;
    yield* readBindingActiveReferenceProjection(tx, location, head.value);
    return head;
  },
);

/** Lock and authenticate the head before selecting its full current evidence.
 * The second statement begins after any head-lock wait, so READ COMMITTED sees
 * the activation inserted by the writer that supplied the newly locked head. */
export const readBindingSelectedEvidence = Effect.fn("DataBindingRepository.readSelectedEvidence")(
  function* (tx: FlarexMetadataTransaction, location: BindingLocation, prepared?: PreparedBindingSelectedStructure) {
    const issuedPreparation = prepared === undefined ? undefined : preparedSelectedStructures.get(prepared);
    if (prepared !== undefined && (issuedPreparation === undefined || issuedPreparation.location.scopeId !== location.scopeId ||
        issuedPreparation.location.storageGeneration !== location.storageGeneration))
      return yield* Effect.fail(bindingError("storedCorruption"));
    if (issuedPreparation !== undefined) yield* Effect.fromResult((issuedPreparation.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
      Result.mapError(cause => bindingError("resourceFailure", cause))));
    const preparation = hasProtectedMetadataFinalGuardScope(tx) ? issuedPreparation : undefined;
    if (preparation !== undefined) yield* registerProtectedMetadataFinalGuard(tx,
      preparation.protection.token, preparation.protection.database, preparation.protection.epoch).pipe(
      Effect.mapError(cause => bindingError("resourceFailure", cause)));
    const snapshot = preparation === undefined ? undefined :
      readStandaloneReadSnapshot(tx, preparation.protection.database, location.scopeId);
    const selectedHead = snapshot === undefined ? yield* readBindingHeadRecord(tx, location, "share") :
      snapshot.bindingHead === null ? Option.none() : Option.some(yield* restoreBindingHeadRecord(snapshot.bindingHead, location));
    if (Option.isNone(selectedHead)) return Option.none();
    const head = selectedHead.value;
    const retained = preparation?.structure;
    if (retained !== undefined && retained.activation.frame.request.scopeId === head.frame.scopeId &&
      retained.activation.frame.request.storageGeneration === head.frame.storageGeneration &&
      retained.activation.frame.sequence === head.frame.sequence && retained.activation.sha256 === head.frame.activationSha256 &&
      retained.candidate.sha256 === head.frame.candidateSha256) {
      yield* decodeActiveReferenceProjection(retained.activation, head);
      return Option.some(Object.freeze({ head, candidate: structuredClone(retained.candidate) }));
    }
    const rows = yield* bindingStatement(tx.select({
      activation: {
        ...getTableColumns(activations),
        canonicalBytes: singleCanonicalBytes(activations.canonicalBytes),
      },
      candidate: {
        ...getTableColumns(candidates),
        canonicalBytes: singleCanonicalBytes(candidates.canonicalBytes),
      },
      lane: getTableColumns(lanes),
    }).from(activations).leftJoin(candidates, and(
      eq(candidates.scopeId, activations.scopeId),
      eq(candidates.storageGeneration, activations.storageGeneration),
      eq(candidates.sha256, head.frame.candidateSha256),
    )).leftJoin(lanes, and(
      eq(lanes.scopeId, candidates.scopeId),
      eq(lanes.storageGeneration, candidates.storageGeneration),
      eq(lanes.candidateSha256, candidates.sha256),
    )).where(and(
      eq(activations.scopeId, location.scopeId),
      eq(activations.storageGeneration, location.storageGeneration),
      eq(activations.sequence, BigInt(head.frame.sequence)),
    )).limit(MAX_COMMERCE_BINDINGS + 2));
    const record = (rows.find(value => value.activation.canonicalBytes !== null) ?? rows[0])
      ?.activation;
    if (record === undefined) return yield* Effect.fail(bindingError("storedCorruption"));
    const activation = yield* decodeActivationRow(record);
    yield* decodeActiveReferenceProjection(activation, head);
    const candidate = (rows.find(value => value.candidate !== null && value.candidate.canonicalBytes !== null) ?? rows[0])
      ?.candidate;
    if (candidate === undefined || candidate === null) return Option.none();
    const storedLanes = rows.flatMap(value => value.lane === null ? [] : [value.lane]);
    const restored = yield* decodeCandidateWithLanes(candidate, storedLanes, location);
    if (preparation !== undefined && preparation.structure === undefined) {
      yield* authenticateProtectedTargetMetadataSnapshot(preparation.protection, tx).pipe(
        Effect.mapError(cause => bindingError("resourceFailure", cause)));
      yield* Effect.suspend(() => {
        if (preparation.structure !== undefined) return Effect.void;
        const structure = structuredClone({ candidate: restored, activation });
        return Effect.fromResult((preparation.lifetime?.charge(structure) ?? Result.succeed(undefined)).pipe(
          Result.mapError(cause => bindingError("resourceFailure", cause)),
          Result.map(() => { preparation.structure = structure; })));
      });
    }
    return Option.some(Object.freeze({ head, candidate: restored }));
  },
);

/** The head's digest binds this larger, activation-time policy projection.
 * Only affected publishers need to read it; both reads use one target transaction. */
export const readBindingActiveReferenceProjection = Effect.fn("DataBindingRepository.readActiveReferences")(
  function* (tx: FlarexMetadataTransaction, location: BindingLocation,
    head: StoredBindingValue<DataBindingHeadFrame>) {
    if (head.frame.scopeId !== location.scopeId || head.frame.storageGeneration !== location.storageGeneration)
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
          eq(activations.sequence, BigInt(head.frame.sequence)),
          ),
        )
        .limit(1),
    );
    const record = records[0];
    if (record === undefined)
      return yield* Effect.fail(bindingError("storedCorruption"));
    const activation = yield* decodeActivationRow(record);
    return yield* decodeActiveReferenceProjection(activation, head);
  },
);
const decodeActiveReferenceProjection = Effect.fn("DataBindingRepository.decodeActiveReferences")(
  function* (activation: Effect.Success<ReturnType<typeof decodeActivationRow>>,
    head: StoredBindingValue<DataBindingHeadFrame>) {
    if (
      activation.sha256 !== head.frame.activationSha256 ||
      activation.frame.request.candidateSha256 !== head.frame.candidateSha256
    ) {
      return yield* Effect.fail(bindingError("storedCorruption"));
    }
    const endpoints = [...new Set(activation.frame.strongReferences.flatMap(reference =>
      [reference.sourceTableId, reference.targetTableId]))].toSorted((left, right) => left - right);
    if (endpoints.length !== head.frame.strongReferenceTableIds.length ||
      endpoints.some((id, index) => id !== head.frame.strongReferenceTableIds[index]))
      return yield* Effect.fail(bindingError("storedCorruption"));
    return activation.frame.strongReferences;
  },
);
/** One bounded, authenticated head read for the common publication gate. The
 * full activation/candidate check remains with source admission. */
export const readBindingHeadProjection = Effect.fn("DataBindingRepository.readHeadProjection")(
  function* (tx: FlarexMetadataTransaction, location: BindingLocation,
    observeQuery?: (query: { readonly sql: string; readonly params: readonly unknown[] }) => void) {
    const query = tx.select({
      sha256: heads.sha256,
      canonicalBytes: boundedBytes(heads.canonicalBytes),
      canonicalByteLength: heads.canonicalByteLength,
      candidateSha256: heads.candidateSha256,
      activationSha256: heads.activationSha256,
      sequence: heads.sequence,
    }).from(heads).where(and(eq(heads.scopeId, location.scopeId),
      eq(heads.storageGeneration, location.storageGeneration))).limit(1);
    observeQuery?.(query.toSQL());
    const rows = yield* bindingStatement(query);
    const row = rows[0];
    if (row === undefined) return Option.none();
    const restored = yield* decode(row, "flarex.data-binding-head", isDataBindingHeadFrame);
    if (restored.frame.scopeId !== location.scopeId ||
      restored.frame.storageGeneration !== location.storageGeneration ||
      restored.frame.candidateSha256 !== row.candidateSha256 ||
      restored.frame.activationSha256 !== row.activationSha256 ||
      restored.frame.sequence !== row.sequence.toString())
      return yield* Effect.fail(bindingError("storedCorruption"));
    return Option.some(restored);
  },
);
export const writeBindingActivation = Effect.fn(
  "DataBindingRepository.writeActivation",
)(function* (
  tx: FlarexMetadataTransaction,
  request: DataBindingActivationRequest,
  strongReferences: readonly StrongReferenceActivationProjection[],
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
      version: 2,
      request,
      sequence: sequence.toString(),
      activatedAt: now.toISOString(),
      strongReferences,
    },
    isDataBindingActivationFrame,
  );
  const strongReferenceTableIds = [...new Set(strongReferences.flatMap(reference =>
    [reference.sourceTableId, reference.targetTableId]))].toSorted((left, right) => left - right);
  const head = yield* captureBindingValue(
    {
      format: "flarex.data-binding-head",
      version: 2,
      scopeId: request.scopeId,
      storageGeneration: request.storageGeneration,
      sequence: sequence.toString(),
      candidateSha256: request.candidateSha256,
      activationSha256: activation.sha256Hex,
      strongReferenceTableIds,
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
