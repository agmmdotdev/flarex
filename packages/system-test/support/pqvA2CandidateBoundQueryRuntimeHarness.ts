import {
  executePointQueryV1,
  PointQueryRuntimeReadBoundaryV1Error,
  type PointQueryRuntimeDatabaseV1,
  type PointQueryRuntimeInvocationFactoryV1,
} from "@flarex/function-runtime/point-query";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

import {
  claimCandidateBoundPointQueryRuntimeTargetV1,
  prepareCandidateBoundPointQueryRuntimeTargetV1,
  readCandidateBoundPointQueryDocumentV1,
  revalidateCandidateBoundPointQueryRuntimeTargetV1,
  validateCandidateBoundPointQueryResultV1,
  type CandidateBoundQueryRuntimeTargetAuthorityPortV1,
} from "flarex-backend/internal/candidate-bound-point-query-runtime-target-v1";
import type { DeclarativeV2RuntimeArtifactR2StoreV1 } from
  "flarex-backend/internal/declarative-v2-runtime-artifact-r2-v1";
import {
  activateApplicationRevisionV1,
  inspectActiveApplicationRevisionSelectionV1,
  readActiveApplicationRevisionV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  inspectApplicationPointQuerySnapshotV1,
  openApplicationPointQuerySnapshotV1,
  readApplicationPointQueryDocumentV1,
  revalidateApplicationPointQuerySnapshotV1,
  type AuthenticatedApplicationPointQuerySnapshotV1,
} from "@flarex/persistence-postgres/internal/application-point-query-snapshot-v1";
import {
  claimApplicationRevisionQueryRuntimeTargetAuthorityV1,
} from "@flarex/persistence-postgres/internal/application-revision-query-runtime-target-v1";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/postgres";
import {
  FSV05_SUPPORTED_LOCATOR,
  prepareFsv05ReadyRevisionFixtureV1,
  type Fsv05ApplicationRevisionActivationLaneV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import {
  appendPqvA1DocumentCommitV1,
  pqvA1TableIdForRevision,
} from "./pqvA1ApplicationPointQuerySnapshotHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export interface PqvA2CandidateBoundQueryRuntimeLaneV1
  extends Fsv05ApplicationRevisionActivationLaneV1 {
  readonly persistence: Persistence;
}

export interface PqvA2CandidateBoundQueryRuntimeProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly presentStatus: "pending";
  readonly missing: true;
  readonly deterministicReplay: true;
  readonly coldReplay: true;
  readonly cloneRejected: true;
  readonly closedSelectionRejected: true;
  readonly closedSnapshotRejected: true;
  readonly closedTargetRejected: true;
  readonly mixedSnapshotRejected: true;
  readonly supersededZeroReadRejected: true;
  readonly functionEvidenceRejected: true;
  readonly unknownFunctionRejected: true;
  readonly missingObjectRejected: true;
  readonly corruptObjectRejected: true;
  readonly budgetRejected: true;
  readonly interruptionPreserved: true;
  readonly noMutationPublication: true;
  readonly postgresVersion: string | null;
}

const FUNCTION_PATH = "orders:get";
const COMPATIBILITY_DATE = "2026-08-03";
const SNAPSHOT_BUDGET = Object.freeze({
  maximumPointReads: 32,
  maximumDocumentBytes: 1_048_576,
});
const TARGET_BUDGET = Object.freeze({
  maximumModules: 64,
  maximumObjects: 128,
  maximumObjectBytes: 16 * 1_048_576,
  maximumRawBytes: 8 * 1_048_576,
  maximumHashBytes: 64 * 1_048_576,
  maximumResultBytes: 1_048_576,
});
const ROW_ID = decodeAppRowIdHexV1("81".repeat(16));
const MISSING_ROW_ID = decodeAppRowIdHexV1("82".repeat(16));

function queryReadPortV1() {
  return Object.freeze({
    revalidate: revalidateApplicationPointQuerySnapshotV1,
    read: readApplicationPointQueryDocumentV1,
  });
}

export async function provePqvA2CandidateBoundQueryRuntimeV1(
  lane: PqvA2CandidateBoundQueryRuntimeLaneV1,
): Promise<PqvA2CandidateBoundQueryRuntimeProofV1> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const ready = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "pqv-a2-query",
    true,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(ready.revisionId, null, ready.context),
  ));
  const activeMetadata = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(ready.context),
  ));
  const replacementReady = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "pqv-a2-query-replacement",
    false,
  );
  const tableId = await pqvA1TableIdForRevision(
    lane.persistence,
    ready.revisionId,
  );
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId: ROW_ID });
  const missingDocumentId = appDocumentIdV1FromRowIdentity({
    tableId,
    rowId: MISSING_ROW_ID,
  });
  await appendPqvA1DocumentCommitV1(lane.persistence, {
    deploymentId: ready.deploymentId,
    tableId,
    rowId: ROW_ID,
    schemaVersionId: activeMetadata.metadata.schemaVersionId,
    previousCommitSeq: null,
    status: "pending",
  });
  const before = await mutationPublicationCounts(lane.persistence);

  let issuedSelection: unknown;
  let issuedSnapshot: unknown;
  let issuedTarget: unknown;
  const warm = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(ready.context);
    issuedSelection = active.selection;
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      FUNCTION_PATH,
      SNAPSHOT_BUDGET,
      ready.context,
    );
    issuedSnapshot = opened.capability;
    const authorityPort = queryAuthorityPort();
    const first = yield* prepareCandidateBoundPointQueryRuntimeTargetV1(
      active.selection,
      opened.capability,
      FUNCTION_PATH,
      authorityPort,
      queryReadPortV1(),
      artifacts.store,
      TARGET_BUDGET,
      COMPATIBILITY_DATE,
    );
    issuedTarget = first.target;
    const claimed = Result.getOrThrow(
      claimCandidateBoundPointQueryRuntimeTargetV1(first.target),
    );
    const present = yield* Effect.tryPromise({
      try: () => executeClaimedQuery(claimed, first.target, documentId, tableId),
      catch: cause => cause,
    });
    const missing = yield* Effect.tryPromise({
      try: () => executeClaimedQuery(
        claimed,
        first.target,
        missingDocumentId,
        tableId,
      ),
      catch: cause => cause,
    });
    const replay = yield* prepareCandidateBoundPointQueryRuntimeTargetV1(
      active.selection,
      opened.capability,
      FUNCTION_PATH,
      authorityPort,
      queryReadPortV1(),
      artifacts.store,
      TARGET_BUDGET,
      COMPATIBILITY_DATE,
    );
    const cloneRejected = Result.isFailure(
      claimCandidateBoundPointQueryRuntimeTargetV1(
        Object.freeze({ ...first.target }),
      ),
    );
    const unknown = yield* Effect.exit(
      prepareCandidateBoundPointQueryRuntimeTargetV1(
        active.selection,
        opened.capability,
        "orders:missing",
        authorityPort,
        queryReadPortV1(),
        artifacts.store,
        TARGET_BUDGET,
        COMPATIBILITY_DATE,
      ),
    );
    const mixedPort: CandidateBoundQueryRuntimeTargetAuthorityPortV1<
      typeof active.selection,
      typeof opened.capability,
      never
    > = Object.freeze({
      claim: () => authorityPort.claim(
        active.selection,
        opened.capability,
        FUNCTION_PATH,
      ).pipe(Effect.map(authority => Object.freeze({
        ...authority,
        snapshot: Object.freeze({
          ...authority.snapshot,
          snapshotToken: Object.freeze({
            ...authority.snapshot.snapshotToken,
            commitSeq: authority.snapshot.snapshotToken.commitSeq + 1n,
          }),
        }),
      })), Effect.orDie),
    });
    const mixed = yield* Effect.exit(
      prepareCandidateBoundPointQueryRuntimeTargetV1(
        active.selection,
        opened.capability,
        FUNCTION_PATH,
        mixedPort,
        queryReadPortV1(),
        artifacts.store,
        TARGET_BUDGET,
        COMPATIBILITY_DATE,
      ),
    );

    const authority = yield* authorityPort.claim(
      active.selection,
      opened.capability,
      FUNCTION_PATH,
    );
    const functionAuthorityVariants = [
      Object.freeze({ ...authority, function: Object.freeze({
        ...authority.function,
        entry: Object.freeze({
          ...authority.function.entry,
          functionOrdinal: authority.function.entry.functionOrdinal + 1n,
        }),
      }) }),
      Object.freeze({ ...authority, function: Object.freeze({
        ...authority.function,
        entry: Object.freeze({
          ...authority.function.entry,
          functionPath: "orders:other",
        }),
      }) }),
      Object.freeze({ ...authority, function: Object.freeze({
        ...authority.function,
        entry: Object.freeze({
          ...authority.function.entry,
          executionModule: "other.js",
        }),
      }) }),
      Object.freeze({ ...authority, function: Object.freeze({
        ...authority.function,
        entry: Object.freeze({
          ...authority.function.entry,
          exportName: "other",
        }),
      }) }),
    ];
    const functionEvidenceExits = yield* Effect.forEach(
      functionAuthorityVariants,
      variant => Effect.exit(prepareCandidateBoundPointQueryRuntimeTargetV1(
        active.selection,
        opened.capability,
        FUNCTION_PATH,
        Object.freeze({ claim: () => Effect.succeed(variant) }),
        queryReadPortV1(),
        artifacts.store,
        TARGET_BUDGET,
        COMPATIBILITY_DATE,
      )),
    );
    const moduleReference = authority.publication.projections.find(
      projection => projection.frame.group === "transaction",
    )?.modules[0]?.reference;
    if (moduleReference === undefined) return yield* Effect.die(
      new Error("PQV-A2 fixture omitted its transaction module."),
    );
    const body = artifacts.bodies.get(moduleReference.objectKey);
    if (body === undefined) return yield* Effect.die(
      new Error("PQV-A2 fixture omitted its R2 module body."),
    );
    artifacts.replaceBodyForTest(moduleReference.objectKey, undefined);
    const missingObject = yield* Effect.exit(
      prepareCandidateBoundPointQueryRuntimeTargetV1(
        active.selection, opened.capability, FUNCTION_PATH, authorityPort,
        queryReadPortV1(),
        artifacts.store, TARGET_BUDGET, COMPATIBILITY_DATE,
      ),
    );
    artifacts.replaceBodyForTest(moduleReference.objectKey, body);
    const corruptBody = new Uint8Array(body);
    corruptBody[corruptBody.byteLength - 1] ^= 0xff;
    artifacts.replaceBodyForTest(moduleReference.objectKey, corruptBody);
    const corrupt = yield* Effect.exit(
      prepareCandidateBoundPointQueryRuntimeTargetV1(
        active.selection, opened.capability, FUNCTION_PATH, authorityPort,
        queryReadPortV1(),
        artifacts.store, TARGET_BUDGET, COMPATIBILITY_DATE,
      ),
    );
    artifacts.replaceBodyForTest(moduleReference.objectKey, body);
    const resultBudget = yield* Effect.exit(
      validateCandidateBoundPointQueryResultV1(first.target, "x".repeat(2_000_000)),
    );
    const blockingStore: DeclarativeV2RuntimeArtifactR2StoreV1 = Object.freeze({
      ...artifacts.store,
      readImmutableAdmitted: <E>() => Effect.never as Effect.Effect<never, E>,
    });
    const fiber = yield* prepareCandidateBoundPointQueryRuntimeTargetV1(
      active.selection, opened.capability, FUNCTION_PATH, authorityPort,
      queryReadPortV1(),
      blockingStore, TARGET_BUDGET, COMPATIBILITY_DATE,
    ).pipe(Effect.forkChild);
    yield* Fiber.interrupt(fiber);
    const interrupted = yield* Fiber.await(fiber);
    return Object.freeze({
      targetSha256: new Uint8Array(first.runtimeTargetSha256),
      definition: JSON.stringify(claimed.definition),
      presentStatus: requireStatus(present, "pending"),
      missing: missing === null,
      deterministicReplay: bytesEqual(
        first.runtimeTargetSha256,
        replay.runtimeTargetSha256,
      ),
      cloneRejected,
      unknownFunctionRejected: taggedFailure(
        unknown,
        "ApplicationRevisionQueryRuntimeTargetV1Error",
      ),
      mixedSnapshotRejected: taggedFailure(
        mixed,
        "CandidateBoundQueryRuntimeDispatchV1Error",
      ),
      functionEvidenceRejected: functionEvidenceExits.every(exit =>
        taggedFailure(exit, "CandidateBoundQueryRuntimeDispatchV1Error")
      ),
      missingObjectRejected: taggedFailure(
        missingObject,
        "DeclarativeV2RuntimeArtifactR2NotFoundV1Error",
      ),
      corruptObjectRejected: taggedFailure(
        corrupt,
        "DeclarativeV2RuntimeArtifactR2CorruptionV1Error",
      ),
      budgetRejected: taggedFailure(
        resultBudget,
        "CandidateBoundQueryRuntimeDispatchV1Error",
      ),
      interruptionPreserved: Exit.isFailure(interrupted) &&
        Cause.hasInterruptsOnly(interrupted.cause),
    });
  })));

  const closedSelectionRejected = Result.isFailure(
    inspectActiveApplicationRevisionSelectionV1(issuedSelection),
  );
  const closedSnapshotRejected = Result.isFailure(
    inspectApplicationPointQuerySnapshotV1(issuedSnapshot),
  );
  const closedTargetRejected = Result.isFailure(
    claimCandidateBoundPointQueryRuntimeTargetV1(issuedTarget),
  );
  const cold = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(ready.context);
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection, FUNCTION_PATH, SNAPSHOT_BUDGET, ready.context,
    );
    const prepared = yield* prepareCandidateBoundPointQueryRuntimeTargetV1(
      active.selection, opened.capability, FUNCTION_PATH, queryAuthorityPort(),
      queryReadPortV1(),
      artifacts.store, TARGET_BUDGET, COMPATIBILITY_DATE,
    );
    const claimed = Result.getOrThrow(
      claimCandidateBoundPointQueryRuntimeTargetV1(prepared.target),
    );
    yield* activateApplicationRevisionV1(
      replacementReady.revisionId,
      active.expectedActiveRevision,
      replacementReady.context,
    );
    const superseded = yield* Effect.exit(
      revalidateCandidateBoundPointQueryRuntimeTargetV1(prepared.target),
    );
    return Object.freeze({
      targetSha256: new Uint8Array(prepared.runtimeTargetSha256),
      definition: JSON.stringify(claimed.definition),
      supersededRejected: taggedFailure(
        superseded,
        "ApplicationPointQuerySnapshotStaleV1Error",
      ),
    });
  })));
  const after = await mutationPublicationCounts(lane.persistence);
  const postgresVersion = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
        "select version() as version",
      )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    presentStatus: warm.presentStatus,
    missing: requireTrue(warm.missing, "missing result"),
    deterministicReplay: requireTrue(warm.deterministicReplay, "warm replay"),
    coldReplay: requireTrue(
      bytesEqual(warm.targetSha256, cold.targetSha256) &&
        warm.definition === cold.definition,
      "cold replay",
    ),
    cloneRejected: requireTrue(warm.cloneRejected, "clone rejection"),
    closedSelectionRejected: requireTrue(closedSelectionRejected, "closed selection"),
    closedSnapshotRejected: requireTrue(closedSnapshotRejected, "closed snapshot"),
    closedTargetRejected: requireTrue(closedTargetRejected, "closed target"),
    mixedSnapshotRejected: requireTrue(warm.mixedSnapshotRejected, "mixed snapshot"),
    supersededZeroReadRejected: requireTrue(
      cold.supersededRejected,
      "superseded zero-read target",
    ),
    functionEvidenceRejected: requireTrue(
      warm.functionEvidenceRejected,
      "function evidence",
    ),
    unknownFunctionRejected: requireTrue(warm.unknownFunctionRejected, "unknown function"),
    missingObjectRejected: requireTrue(warm.missingObjectRejected, "missing R2 object"),
    corruptObjectRejected: requireTrue(warm.corruptObjectRejected, "corrupt R2 object"),
    budgetRejected: requireTrue(warm.budgetRejected, "result budget"),
    interruptionPreserved: requireTrue(warm.interruptionPreserved, "interruption"),
    noMutationPublication: requireTrue(countsEqual(before, after), "no mutation publication"),
    postgresVersion,
  });
}

function queryAuthorityPort() {
  return Object.freeze({ claim: claimApplicationRevisionQueryRuntimeTargetAuthorityV1 });
}

async function executeClaimedQuery(
  claimed: ReturnType<typeof claimCandidateBoundPointQueryRuntimeTargetV1> extends
    Result.Result<infer A, unknown> ? A : never,
  target: Parameters<typeof readCandidateBoundPointQueryDocumentV1>[0],
  documentId: string,
  tableId: number,
) {
  const source = claimed.definition.modules["orders.js"];
  if (source === undefined) throw new Error("PQV-A2 exact query module is missing.");
  const sourceModule: unknown = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  if (typeof sourceModule !== "object" || sourceModule === null ||
    !("get" in sourceModule) || typeof sourceModule.get !== "function") {
    throw new Error("PQV-A2 exact query export is missing.");
  }
  const runtimeFunction = Object.freeze({
    isQuery: true,
    isPublic: true,
    _handler: sourceModule.get,
  });
  const factory = queryInvocationFactory(target);
  await Effect.runPromise(
    revalidateCandidateBoundPointQueryRuntimeTargetV1(target),
  );
  const argumentsValue = normalizeFlarexValueV1({ id: documentId }).value;
  if (!isRuntimeObject(argumentsValue)) throw new Error("PQV-A2 args are invalid.");
  const result = await executePointQueryV1({
    function: claimed.function,
    arguments: argumentsValue,
    tables: Object.freeze([{ tableId, logicalName: "orders" }]),
  }, Object.freeze({ resolve: () => runtimeFunction }), factory);
  return Effect.runPromise(validateCandidateBoundPointQueryResultV1(target, result));
}

function queryInvocationFactory(
  target: Parameters<typeof readCandidateBoundPointQueryDocumentV1>[0],
): PointQueryRuntimeInvocationFactoryV1 {
  const pending = new Set<Promise<unknown>>();
  let failure: unknown;
  let closed = false;
  const get: PointQueryRuntimeDatabaseV1["get"] = documentId => {
    if (closed) throw new PointQueryRuntimeReadBoundaryV1Error(
      new Error("PQV-A2 read boundary is closed."),
    );
    const read = Effect.runPromise(readCandidateBoundPointQueryDocumentV1(
      target,
      { tableName: "orders", documentId },
    )).then(result => {
      if (!isPointReadResult(result)) {
        throw new Error("PQV-A2 point-read result was invalid.");
      }
      return result.kind === "missing" ? null : result.document;
    })
      .catch(cause => {
        failure ??= cause;
        throw new PointQueryRuntimeReadBoundaryV1Error(cause);
      });
    pending.add(read);
    const cleanup = () => { pending.delete(read); };
    void read.then(cleanup, cleanup);
    return read;
  };
  const unavailable = (): never => {
    throw new Error("Forbidden point-query syscall.");
  };
  return Object.freeze({
    open: () => Object.freeze({
      context: Object.freeze({
        auth: Object.freeze({ getUserIdentity: async () => null }),
        db: Object.freeze({
          get,
          insert: unavailable,
          patch: unavailable,
          replace: unavailable,
          delete: unavailable,
          query: unavailable,
          normalizeId: unavailable,
          system: Object.freeze({}),
        }),
      }),
      readBoundary: Object.freeze({
        close: () => { closed = true; },
        drain: async () => {
          await Promise.allSettled([...pending]);
          if (failure !== undefined) throw failure;
        },
      }),
    }),
  });
}

function isRuntimeObject(value: unknown): value is CanonicalFlarexRuntimeObjectV1 {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    !(value instanceof ArrayBuffer);
}
function isPointReadResult(value: unknown): value is
  | Readonly<{ readonly kind: "missing" }>
  | Readonly<{
      readonly kind: "present";
      readonly document: CanonicalFlarexRuntimeObjectV1;
    }> {
  return typeof value === "object" && value !== null && "kind" in value &&
    (value.kind === "missing" ||
      (value.kind === "present" && "document" in value &&
        isRuntimeObject(value.document)));
}
function requireStatus(value: CanonicalFlarexRuntimeValueV1, expected: string) {
  if (!isRuntimeObject(value) || value.status !== expected) {
    throw new Error(`PQV-A2 expected status ${expected}.`);
  }
  return expected as "pending";
}
function taggedFailure(exit: Exit.Exit<unknown, unknown>, tag: string) {
  if (Exit.isSuccess(exit)) return false;
  const failure = Cause.squash(exit.cause);
  return typeof failure === "object" && failure !== null &&
    "_tag" in failure && failure._tag === tag;
}
function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}
function requireTrue(value: boolean, label: string): true {
  if (!value) throw new Error(`PQV-A2 did not prove ${label}.`);
  return true;
}

async function mutationPublicationCounts(persistence: Persistence) {
  const result = await persistence.query<{
    app_rows: string;
    outcomes: string;
    commits: string;
    changes: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_app_row_rev) as app_rows,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_commit_app_row_change) as changes,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("PQV-A2 publication counts are missing.");
  return row;
}
function countsEqual(left: object, right: object) {
  return JSON.stringify(left) === JSON.stringify(right);
}

void FSV05_SUPPORTED_LOCATOR;
