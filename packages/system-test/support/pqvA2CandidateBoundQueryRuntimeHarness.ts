import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { Miniflare } from "miniflare";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodePointQueryExactRuntimeResultV1Effect,
  POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
  POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
  type PointQueryExactRuntimeRequestV1,
} from "flarex-protocol/point-query-exact-runtime";
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
} from "@flarex/persistence-postgres/internal/system-test/application-revision-activation-v1";
import {
  inspectApplicationPointQuerySnapshotV1,
  openApplicationPointQuerySnapshotV1,
  readApplicationPointQueryDocumentV1,
  revalidateApplicationPointQuerySnapshotV1,
  type AuthenticatedApplicationPointQuerySnapshotV1,
} from "@flarex/persistence-postgres/internal/system-test/application-point-query-snapshot-v1";
import {
  claimApplicationRevisionQueryRuntimeTargetAuthorityV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-query-runtime-target-v1";
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
const COMPATIBILITY_DATE = "2026-06-11";
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
    const present = yield* executeClaimedQuery(
      claimed,
      first.target,
      documentId,
    );
    const missing = yield* executeClaimedQuery(
      claimed,
      first.target,
      missingDocumentId,
    );
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

const executeClaimedQuery = Effect.fn("PqvA2.executeClaimedQuery")(function* (
  claimed: ReturnType<typeof claimCandidateBoundPointQueryRuntimeTargetV1> extends
    Result.Result<infer A, unknown> ? A : never,
  target: Parameters<typeof readCandidateBoundPointQueryDocumentV1>[0],
  documentId: string,
) {
  const normalizedArguments = yield* Effect.try({
    try: () => normalizeFlarexValueV1({ id: documentId }),
    catch: cause => cause,
  });
  if (!isRuntimeObject(normalizedArguments.value)) {
    return yield* Effect.fail(new Error("PQV-A2 args are invalid."));
  }
  const request = Object.freeze({
    format: POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
    version: POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
    runtimeTargetSha256: claimed.runtimeTargetSha256,
    artifact: claimed.artifact,
    function: claimed.function,
    auth: Object.freeze({ kind: "anonymous" as const }),
    arguments: normalizedArguments.value,
    argumentSemanticBytes: normalizedArguments.semanticSizeBytes,
    tables: claimed.tables,
    context: Object.freeze({
      executionId: `pqv-a2-${documentId}`,
      randomSeed: new Uint8Array(32).fill(7),
      executionTime: Date.UTC(2026, 5, 11),
      snapshotCommitSeq: claimed.snapshotCommitSeq,
    }),
  }) satisfies PointQueryExactRuntimeRequestV1;
  const runtime = yield* Effect.acquireRelease(
    Effect.try({
      try: () => new Miniflare({
        compatibilityDate: claimed.definition.compatibilityDate,
        modules: [
          {
            type: "ESModule" as const,
            path: "pqv-a2-dispatch.js",
            contents: pointQueryDispatchModuleSource(
              claimed.definition.mainModule,
            ),
          },
          ...Object.entries(claimed.definition.modules).map(
            ([path, contents]) => ({
              type: "ESModule" as const,
              path,
              contents,
            }),
          ),
        ],
        serviceBindings: {
          SNAPSHOT: async (input: Request) =>
            snapshotServiceBinding(input, target),
        },
      }),
      catch: cause => cause,
    }),
    runtime => Effect.promise(() => runtime.dispose()),
  );
  const response = yield* Effect.tryPromise({
    try: signal => runtime.dispatchFetch("https://pqv-a2.test/", {
      method: "POST",
      body: JSON.stringify(serializePointQueryRequest(request)),
      signal,
    }),
    catch: cause => cause,
  });
  const envelope: unknown = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: cause => cause,
  });
  if (!isNonArrayRecord(envelope) || envelope.ok !== true) {
    return yield* Effect.fail(
      new Error("PQV-A2 exact query Worker failed.", { cause: envelope }),
    );
  }
  const result = yield* decodePointQueryExactRuntimeResultV1Effect(
    envelope.result,
  );
  return yield* validateCandidateBoundPointQueryResultV1(target, result.value);
});

async function snapshotServiceBinding(
  input: Request,
  target: Parameters<typeof readCandidateBoundPointQueryDocumentV1>[0],
): Promise<Response> {
  try {
    if (new URL(input.url).pathname === "/revalidate") {
      await Effect.runPromise(
        revalidateCandidateBoundPointQueryRuntimeTargetV1(target),
      );
      return Response.json({ ok: true, result: null });
    }
    const body: unknown = await input.json();
    if (!isNonArrayRecord(body) || typeof body.tableName !== "string" ||
      typeof body.documentId !== "string") {
      throw new Error("PQV-A2 point-read request is invalid.");
    }
    const result = await Effect.runPromise(
      readCandidateBoundPointQueryDocumentV1(target, {
        tableName: body.tableName,
        documentId: body.documentId,
      }),
    );
    return Response.json({ ok: true, result });
  } catch (cause) {
    return Response.json({
      ok: false,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function pointQueryDispatchModuleSource(mainModule: string): string {
  return `import { FlarexPointQueryExactRuntimeV1 } from ${JSON.stringify(`./${mainModule}`)};
export default {
  async fetch(request, env) {
    const input = await request.json();
    input.runtimeTargetSha256 = new Uint8Array(input.runtimeTargetSha256);
    input.context.randomSeed = new Uint8Array(input.context.randomSeed);
    input.context.snapshotCommitSeq = BigInt(input.context.snapshotCommitSeq);
    const capability = {
      revalidate: async () => {
        const response = await env.SNAPSHOT.fetch("https://snapshot/revalidate", { method: "POST" });
        const value = await response.json();
        if (!value.ok) throw new Error(value.message);
      },
      readPointDocument: async (tableName, documentId) => {
        const response = await env.SNAPSHOT.fetch("https://snapshot/read", {
          method: "POST",
          body: JSON.stringify({ tableName, documentId }),
        });
        const value = await response.json();
        if (!value.ok) throw new Error(value.message);
        return value.result;
      },
    };
    try {
      const result = await Reflect.apply(
        FlarexPointQueryExactRuntimeV1.prototype.run,
        {},
        [input, capability],
      );
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({ ok: false, name: error?.name, message: error?.message });
    }
  },
};`;
}

function serializePointQueryRequest(
  request: PointQueryExactRuntimeRequestV1,
) {
  return {
    ...request,
    runtimeTargetSha256: Array.from(request.runtimeTargetSha256),
    context: {
      ...request.context,
      randomSeed: Array.from(request.context.randomSeed),
      snapshotCommitSeq: request.context.snapshotCommitSeq.toString(),
    },
  };
}

function isRuntimeObject(value: unknown): value is CanonicalFlarexRuntimeObjectV1 {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    !(value instanceof ArrayBuffer);
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
