import { Cause, Effect, Exit, Fiber, Result } from "effect";

import {
  claimCandidateBoundPointMutationRuntimeTargetV1,
  prepareCandidateBoundPointMutationRuntimeTargetV1,
  type CandidateBoundRuntimeTargetAuthorityPortV1,
} from "flarex-backend/internal/candidate-bound-point-mutation-runtime-target-v1";
import type {
  DeclarativeV2RuntimeArtifactR2StoreV1,
} from "flarex-backend/internal/declarative-v2-runtime-artifact-r2-v1";
import {
  activateApplicationRevisionV1,
  inspectActiveApplicationRevisionSelectionV1,
  readActiveApplicationRevisionV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  claimApplicationRevisionRuntimeTargetAuthorityV1,
  type ApplicationRevisionRuntimeTargetAuthorityV1,
} from "@flarex/persistence-postgres/internal/application-revision-runtime-target-v1";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/postgres";
import {
  prepareFsv05ReadyRevisionFixtureV1,
  type Fsv05ApplicationRevisionActivationLaneV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

const FUNCTION_PATH = "orders:place";
const COMPATIBILITY_DATE = "2025-04-01";
const BUDGET = Object.freeze({
  maximumModules: 64,
  maximumObjects: 128,
  maximumObjectBytes: 8 * 1_048_576,
  maximumRawBytes: 4 * 1_048_576,
  maximumHashBytes: 64 * 1_048_576,
});

export interface Fsv06A1CandidateBoundRuntimeDispatchLaneV1
  extends Fsv05ApplicationRevisionActivationLaneV1 {
  readonly persistence: Persistence;
}

export interface Fsv06A1CandidateBoundRuntimeDispatchProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly deterministicReplay: true;
  readonly workerGraphChangeRekeysTarget: true;
  readonly coldRestartReplay: true;
  readonly exactWorkerDefinition: true;
  readonly cloneRejected: true;
  readonly closedSelectionRejected: true;
  readonly closedTargetRejected: true;
  readonly unknownFunctionRejected: true;
  readonly mixedAuthorityRejected: true;
  readonly substitutedFunctionRejected: true;
  readonly missingObjectRejected: true;
  readonly corruptObjectRejected: true;
  readonly objectBudgetRejected: true;
  readonly accessorBudgetRejected: true;
  readonly interruptionPreserved: true;
  readonly runtimeTargetSha256Hex: string;
  readonly postgresVersion: string | null;
}

export async function proveFsv06A1CandidateBoundRuntimeDispatchV1(
  lane: Fsv06A1CandidateBoundRuntimeDispatchLaneV1,
): Promise<Fsv06A1CandidateBoundRuntimeDispatchProofV1> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const ready = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    undefined,
    true,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(ready.revisionId, null, ready.context),
  ));

  let issuedSelection: unknown;
  let issuedTarget: unknown;
  const warm = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(ready.context);
    issuedSelection = active.selection;
    const authorityPort = runtimeAuthorityPort();
    const authority = yield* authorityPort.claim(active.selection, FUNCTION_PATH);
    const first = yield* prepareCandidateBoundPointMutationRuntimeTargetV1(
      active.selection,
      FUNCTION_PATH,
      authorityPort,
      artifacts.store,
      BUDGET,
      COMPATIBILITY_DATE,
    );
    issuedTarget = first.target;
    const claimed = Result.getOrThrow(
      claimCandidateBoundPointMutationRuntimeTargetV1(first.target),
    );
    const replay = yield* prepareCandidateBoundPointMutationRuntimeTargetV1(
      active.selection,
      FUNCTION_PATH,
      authorityPort,
      artifacts.store,
      BUDGET,
      COMPATIBILITY_DATE,
    );
    const replayClaimed = Result.getOrThrow(
      claimCandidateBoundPointMutationRuntimeTargetV1(replay.target),
    );
    const changedCompatibility = yield*
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        FUNCTION_PATH,
        authorityPort,
        artifacts.store,
        BUDGET,
        "2025-04-02",
      );
    if (bytesEqual(
      first.runtimeTargetSha256,
      changedCompatibility.runtimeTargetSha256,
    )) throw new Error("FSV06-A1 reused an identity for another Worker graph.");
    const invalidCompatibility = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        FUNCTION_PATH,
        authorityPort,
        artifacts.store,
        BUDGET,
        "2025-02-30",
      ),
    );
    requireHostFailureReason(invalidCompatibility, "workerDefinitionFailed");
    const clonedTargetRejected = Result.isFailure(
      claimCandidateBoundPointMutationRuntimeTargetV1(
        Object.freeze({ ...first.target }),
      ),
    );
    if (!clonedTargetRejected) throw new Error("FSV06-A1 accepted a cloned target.");

    const unknown = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        "orders:missing",
        authorityPort,
        artifacts.store,
        BUDGET,
        COMPATIBILITY_DATE,
      ),
    );
    requireFailureTag(unknown, "ApplicationRevisionRuntimeTargetV1Error");

    const mixedPort: CandidateBoundRuntimeTargetAuthorityPortV1<
      typeof active.selection,
      never
    > = Object.freeze({
      claim: () => Effect.succeed(Object.freeze({
        ...authority,
        metadata: Object.freeze({
          ...authority.metadata,
          candidateSha256: new Uint8Array(32).fill(0xff),
        }),
      })),
    });
    const mixed = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        FUNCTION_PATH,
        mixedPort,
        artifacts.store,
        BUDGET,
        COMPATIBILITY_DATE,
      ),
    );
    requireFailureReason(mixed, "authorityMismatch");

    const substitutedPort: CandidateBoundRuntimeTargetAuthorityPortV1<
      typeof active.selection,
      never
    > = Object.freeze({ claim: () => Effect.succeed(authority) });
    const substituted = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        "orders:substituted",
        substitutedPort,
        artifacts.store,
        BUDGET,
        COMPATIBILITY_DATE,
      ),
    );
    requireFailureReason(substituted, "authorityMismatch");

    const moduleReference = authority.publication.projections.find(
      projection => projection.frame.group === "transaction",
    )?.modules[0]?.reference;
    if (moduleReference === undefined) {
      throw new Error("FSV06-A1 fixture omitted its transaction module.");
    }
    const originalBody = artifacts.bodies.get(moduleReference.objectKey);
    if (originalBody === undefined) {
      throw new Error("FSV06-A1 fixture omitted its R2 module body.");
    }
    artifacts.replaceBodyForTest(moduleReference.objectKey, undefined);
    const missing = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        FUNCTION_PATH,
        authorityPort,
        artifacts.store,
        BUDGET,
        COMPATIBILITY_DATE,
      ),
    );
    artifacts.replaceBodyForTest(moduleReference.objectKey, originalBody);
    requireFailureTag(missing, "DeclarativeV2RuntimeArtifactR2NotFoundV1Error");

    const corrupted = new Uint8Array(originalBody);
    corrupted[corrupted.byteLength - 1] ^= 0xff;
    artifacts.replaceBodyForTest(moduleReference.objectKey, corrupted);
    const corrupt = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        FUNCTION_PATH,
        authorityPort,
        artifacts.store,
        BUDGET,
        COMPATIBILITY_DATE,
      ),
    );
    artifacts.replaceBodyForTest(moduleReference.objectKey, originalBody);
    requireFailureTag(corrupt, "DeclarativeV2RuntimeArtifactR2CorruptionV1Error");

    const budgeted = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        FUNCTION_PATH,
        authorityPort,
        artifacts.store,
        { ...BUDGET, maximumObjects: 0 },
        COMPATIBILITY_DATE,
      ),
    );
    requireFailureReason(budgeted, "resourceExceeded");
    const accessorBudget = Object.create(Object.prototype);
    for (const [key, value] of Object.entries(BUDGET)) {
      Object.defineProperty(accessorBudget, key, {
        enumerable: true,
        ...(key === "maximumObjects" ? { get: () => value } : { value }),
      });
    }
    const accessorBudgetExit = yield* Effect.exit(
      prepareCandidateBoundPointMutationRuntimeTargetV1(
        active.selection,
        FUNCTION_PATH,
        authorityPort,
        artifacts.store,
        accessorBudget,
        COMPATIBILITY_DATE,
      ),
    );
    requireFailureReason(accessorBudgetExit, "invalidBudget");

    const blockingStore: DeclarativeV2RuntimeArtifactR2StoreV1 = Object.freeze({
      ...artifacts.store,
      readImmutableAdmitted: <E>() => Effect.never as Effect.Effect<never, E>,
    });
    const interruptedFiber = yield* prepareCandidateBoundPointMutationRuntimeTargetV1(
      active.selection,
      FUNCTION_PATH,
      authorityPort,
      blockingStore,
      BUDGET,
      COMPATIBILITY_DATE,
    ).pipe(Effect.forkChild);
    yield* Fiber.interrupt(interruptedFiber);
    const interrupted = yield* Fiber.await(interruptedFiber);
    if (!Exit.isFailure(interrupted) || !Cause.hasInterruptsOnly(interrupted.cause)) {
      throw new Error("FSV06-A1 converted interruption into domain failure.");
    }

    const sourceModulePresent = Object.keys(claimed.definition.modules).some(
      path => path.endsWith("orders.js"),
    );
    const executionBridge = Object.values(claimed.definition.modules).find(
      source => source.includes("isMutation: true") &&
        source.includes("applicationModuleV1"),
    );
    if (
      !sourceModulePresent || executionBridge === undefined ||
      !executionBridge.includes("isMutation: true") ||
      !executionBridge.includes("orders") ||
      !executionBridge.includes("place")
    ) throw new Error("FSV06-A1 did not build the exact mutation registry.");

    return Object.freeze({
      runtimeTargetSha256: new Uint8Array(first.runtimeTargetSha256),
      definitionBytes: JSON.stringify(claimed.definition),
      deterministicReplay:
        bytesEqual(first.runtimeTargetSha256, replay.runtimeTargetSha256) &&
        JSON.stringify(claimed.definition) ===
          JSON.stringify(replayClaimed.definition),
      exactWorkerDefinition: true as const,
    });
  })));

  const closedSelectionRejected = Result.isFailure(
    inspectActiveApplicationRevisionSelectionV1(issuedSelection),
  );
  const closedTargetRejected = Result.isFailure(
    claimCandidateBoundPointMutationRuntimeTargetV1(issuedTarget),
  );
  if (!closedSelectionRejected || !closedTargetRejected) {
    throw new Error("FSV06-A1 authority survived its owning Scope.");
  }

  const cold = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(ready.context);
    const prepared = yield* prepareCandidateBoundPointMutationRuntimeTargetV1(
      active.selection,
      FUNCTION_PATH,
      runtimeAuthorityPort(),
      artifacts.store,
      BUDGET,
      COMPATIBILITY_DATE,
    );
    const claimed = Result.getOrThrow(
      claimCandidateBoundPointMutationRuntimeTargetV1(prepared.target),
    );
    return Object.freeze({
      runtimeTargetSha256: new Uint8Array(prepared.runtimeTargetSha256),
      definitionBytes: JSON.stringify(claimed.definition),
    });
  })));
  const coldRestartReplay =
    bytesEqual(warm.runtimeTargetSha256, cold.runtimeTargetSha256) &&
    warm.definitionBytes === cold.definitionBytes;
  if (!warm.deterministicReplay || !coldRestartReplay) {
    throw new Error("FSV06-A1 runtime target was not replay-stable.");
  }

  const version = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
      "select version() as version",
    )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    deterministicReplay: true,
    workerGraphChangeRekeysTarget: true,
    coldRestartReplay: true,
    exactWorkerDefinition: warm.exactWorkerDefinition,
    cloneRejected: true,
    closedSelectionRejected: true,
    closedTargetRejected: true,
    unknownFunctionRejected: true,
    mixedAuthorityRejected: true,
    substitutedFunctionRejected: true,
    missingObjectRejected: true,
    corruptObjectRejected: true,
    objectBudgetRejected: true,
    accessorBudgetRejected: true,
    interruptionPreserved: true,
    runtimeTargetSha256Hex: toHex(warm.runtimeTargetSha256),
    postgresVersion: version,
  });
}

function runtimeAuthorityPort() {
  return Object.freeze({ claim: claimApplicationRevisionRuntimeTargetAuthorityV1 });
}

function requireFailureTag(exit: Exit.Exit<unknown, unknown>, tag: string): void {
  if (Exit.isSuccess(exit)) throw new Error(`FSV06-A1 expected ${tag}.`);
  const failure = Cause.squash(exit.cause);
  if (
    typeof failure !== "object" || failure === null ||
    !("_tag" in failure) || failure._tag !== tag
  ) throw new Error(`FSV06-A1 did not preserve ${tag}.`);
}

function requireFailureReason(
  exit: Exit.Exit<unknown, unknown>,
  reason: string,
): void {
  if (Exit.isSuccess(exit)) throw new Error(`FSV06-A1 expected ${reason}.`);
  const failure = Cause.squash(exit.cause);
  if (
    typeof failure !== "object" || failure === null ||
    !("reason" in failure) || failure.reason !== reason
  ) throw new Error(`FSV06-A1 did not preserve ${reason}.`);
}

function requireHostFailureReason(
  exit: Exit.Exit<unknown, unknown>,
  reason: string,
): void {
  if (Exit.isSuccess(exit)) throw new Error(`FSV06-A1 expected ${reason}.`);
  const failure = Cause.squash(exit.cause);
  if (
    typeof failure !== "object" || failure === null ||
    !("issue" in failure) || typeof failure.issue !== "object" ||
    failure.issue === null || !("reason" in failure.issue) ||
    failure.issue.reason !== reason
  ) throw new Error(`FSV06-A1 did not preserve ${reason}.`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
