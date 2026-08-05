import { createHash } from "node:crypto";

import {
  makePrivateApplicationRevisionReadinessCoordinatorV1,
} from "flarex-backend/internal/application-revision-readiness-coordinator-v1";
import {
  probeDeclarativeV2ColdMaterializationV1,
} from "flarex-backend/internal/declarative-v2-cold-materialization-probe-v1";
import { Effect, Exit, Result } from "effect";
import {
  encodeDeclarativeV2PhysicalFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import {
  settleApplicationRevisionReadinessV1,
  type ApplicationRevisionReadinessContextV1,
  type LocatedApplicationRevisionReadinessTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/applicationRevisionReadinessV1";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "@flarex/persistence-postgres/internal/system-test/intrinsicCreationTimeIndexBuildV1";
import {
  reconcilePublishedIndexBuildsV1Effect,
} from "@flarex/persistence-postgres/internal/system-test/indexBuildReconciliation";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/postgres";
import type { LocatedApplicationRevisionRegistrationTargetV1 } from
  "@flarex/persistence-postgres/internal/system-test/applicationRevisionRegistrationV1";
import type { LoadedCandidateRuntimePublicationV1 } from
  "@flarex/persistence-postgres/internal/system-test/candidateRuntimePublicationRepositoryV1";
import {
  prepareFsv04RegisteredRevisionFixtureV1,
} from "./fsv03PrivateAnalyzerToPostgresHarness";
import {
  makeMemoryRuntimeArtifactStoreV1,
} from "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export interface Fsv04ApplicationRevisionReadinessLaneV1 {
  readonly name: "pglite" | "postgres";
  readonly persistence: Persistence;
  readonly registrationTarget:
    LocatedApplicationRevisionRegistrationTargetV1;
  readonly makeReadinessTarget: () =>
    LocatedApplicationRevisionReadinessTargetV1;
  readonly makeDecisionUncertainTarget: () => Readonly<{
    readonly target: LocatedApplicationRevisionReadinessTargetV1;
    readonly wasInjected: () => boolean;
  }>;
}

export interface Fsv04ApplicationRevisionReadinessProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly notReadyReasons: readonly [
    "physicalBuildMissing",
    "physicalBuildNotEnabled",
  ];
  readonly buildLifecycles: ReadonlyArray<string>;
  readonly rollbackBoundaries: readonly [
    "afterVerdictInsert",
    "afterAttemptReady",
  ];
  readonly concurrentDispositions: readonly ["inserted", "replayed"];
  readonly coldReplayDisposition: "replayed";
  readonly decisionUncertainDisposition: "replayed";
  readonly decisionUncertaintyInjected: true;
  readonly coldAuthorityFailures: readonly [
    "missingGroup",
    "projectionMismatch",
  ];
  readonly buildStateInvalidation: true;
  readonly receiptCorruptionRejected: true;
  readonly staleInvalidation: true;
  readonly verdictCount: number;
  readonly activeRevisionCount: number;
  readonly activeHeadCount: number;
  readonly attemptLifecycle: "ready";
  readonly postgresVersion: string | null;
}

const COLD_BUDGET = Object.freeze({
  maximumGroups: 2,
  maximumModulesPerGroup: 32,
  maximumRawBytesPerGroup: 64 * 1_048_576,
  maximumObjects: 128,
  maximumObjectBytes: 64 * 1_048_576,
  maximumCompressedBytesPerGroup: 64 * 1_048_576,
  maximumStartupMilliseconds: 30_000,
});

export async function proveFsv04ApplicationRevisionReadinessV1(
  lane: Fsv04ApplicationRevisionReadinessLaneV1,
): Promise<Fsv04ApplicationRevisionReadinessProofV1> {
  const runtimeArtifacts = makeMemoryRuntimeArtifactStoreV1();
  const registered = await prepareFsv04RegisteredRevisionFixtureV1({
    name: lane.name,
    persistence: lane.persistence,
    registrationTarget: lane.registrationTarget,
    runtimeArtifacts,
  });
  const target = lane.makeReadinessTarget();
  const baseContext = readinessContext(
    registered.deploymentId,
    lane.persistence,
    target,
    runtimeArtifacts,
  );
  const settle = (context = baseContext) => Effect.scoped(
    settleApplicationRevisionReadinessV1(
      registered.registered.revisionId,
      context,
    ),
  );
  const initial = await Effect.runPromise(settle());
  if (initial.status !== "not_ready" ||
    initial.reason !== "physicalBuildMissing") {
    throw new Error("FSV04 did not fail closed before build reconciliation.");
  }
  const reconciliation = await Effect.runPromise(
    reconcilePublishedIndexBuildsV1Effect({
      controlDb: lane.persistence.drizzle,
      authority: authorityPorts(lane.persistence, target),
    }, {
      deploymentId: registered.deploymentId,
      schemaVersionId: registered.registered.schemaVersionId,
    }),
  );
  if (reconciliation.status !== "reconciled" ||
    reconciliation.definitionIds.length === 0) {
    throw new Error("FSV04 physical build reconciliation was absent.");
  }
  const declared = await Effect.runPromise(settle());
  if (declared.status !== "not_ready" ||
    declared.reason !== "physicalBuildNotEnabled") {
    throw new Error("FSV04 treated a declared build as enabled.");
  }
  const buildLifecycles: string[] = [];
  for (const indexDefinitionId of reconciliation.definitionIds) {
    for (let step = 0; step < 64; step += 1) {
      const result = await Effect.runPromise(
        buildIntrinsicCreationTimeIndexV1Effect({
          controlDb: lane.persistence.drizzle,
          authority: authorityPorts(lane.persistence, target),
        }, {
          deploymentId: registered.deploymentId,
          indexDefinitionId,
          pageSize: 4,
        }),
      );
      buildLifecycles.push(result.lifecycle);
      if (result.lifecycle === "enabled") break;
      if (step === 63) throw new Error("FSV04 build did not converge.");
    }
  }

  const coldAuthorityFailures = [
    ["missingGroup", "missing"] as const,
    ["projectionMismatch", "projectionMismatch"] as const,
  ] as const;
  for (const [, mode] of coldAuthorityFailures) {
    const exit = await Effect.runPromise(Effect.exit(settle(readinessContext(
      registered.deploymentId,
      lane.persistence,
      lane.makeReadinessTarget(),
      runtimeArtifacts,
      { mode },
    ))));
    if (Exit.isSuccess(exit)) {
      throw new Error(`FSV04 accepted invalid cold evidence: ${mode}.`);
    }
    const invalidRows = await readinessRows(lane.persistence);
    if (invalidRows.verdictCount !== 0 ||
      invalidRows.attemptLifecycle !== "registering") {
      throw new Error(`FSV04 persisted invalid cold evidence: ${mode}.`);
    }
  }

  const rollbackBoundaries = [
    "afterVerdictInsert",
    "afterAttemptReady",
  ] as const;
  for (const boundary of rollbackBoundaries) {
    const exit = await Effect.runPromise(Effect.exit(settle({
      ...baseContext,
      faultAfter: point => {
        if (point === boundary) throw new Error(`fault:${boundary}`);
      },
    })));
    if (Exit.isSuccess(exit)) {
      throw new Error(`FSV04 fault ${boundary} unexpectedly committed.`);
    }
    const rollback = await readinessRows(lane.persistence);
    if (rollback.verdictCount !== 0 || rollback.attemptLifecycle !== "registering") {
      throw new Error(`FSV04 fault ${boundary} exposed a partial transition.`);
    }
  }

  const materializationBarrier = makeTwoPartyMaterializationBarrier();
  const concurrentContext = readinessContext(
    registered.deploymentId,
    lane.persistence,
    target,
    runtimeArtifacts,
    { beforeProbe: materializationBarrier.arrive },
  );
  const coordinator = makePrivateApplicationRevisionReadinessCoordinatorV1({
    settleApplicationRevisionReadinessV1: (revisionId: string) =>
      settleApplicationRevisionReadinessV1(revisionId, concurrentContext),
  });
  const concurrent = await Promise.all([
    Effect.runPromise(Effect.scoped(coordinator.settle(
      registered.registered.revisionId,
    ))),
    Effect.runPromise(Effect.scoped(coordinator.settle(
      registered.registered.revisionId,
    ))),
  ]);
  const dispositions = concurrent.map(result => {
    if (result.status !== "ready") {
      throw new Error("FSV04 concurrent settlement returned not-ready.");
    }
    return result.disposition;
  }).sort() as ["inserted", "replayed"];
  if (dispositions[0] !== "inserted" || dispositions[1] !== "replayed") {
    throw new Error("FSV04 concurrent settlement was not insert plus replay.");
  }

  const coldContext = readinessContext(
    registered.deploymentId,
    lane.persistence,
    lane.makeReadinessTarget(),
    runtimeArtifacts,
    { mode: "failIfProbed" },
  );
  const coldReplay = await Effect.runPromise(Effect.scoped(
    settleApplicationRevisionReadinessV1(
      registered.registered.revisionId,
      coldContext,
    ),
  ));
  if (coldReplay.status !== "ready" || coldReplay.disposition !== "replayed") {
    throw new Error("FSV04 cold reload did not exactly replay readiness.");
  }
  const uncertainTarget = lane.makeDecisionUncertainTarget();
  const uncertainContext = readinessContext(
    registered.deploymentId,
    lane.persistence,
    uncertainTarget.target,
    runtimeArtifacts,
  );
  const uncertainReplay = await Effect.runPromise(Effect.scoped(
    settleApplicationRevisionReadinessV1(
      registered.registered.revisionId,
      uncertainContext,
    ),
  ));
  if (
    uncertainReplay.status !== "ready" ||
    uncertainReplay.disposition !== "replayed"
  ) throw new Error("FSV04 did not observe decision-uncertain settlement.");
  if (!uncertainTarget.wasInjected()) {
    throw new Error("FSV04 decision-uncertainty branch was not injected.");
  }
  const rows = await readinessRows(lane.persistence);
  if (
    rows.verdictCount !== 1 ||
    rows.attemptLifecycle !== "ready" ||
    rows.activeRevisionCount !== 0 ||
    rows.activeHeadCount !== 0
  ) throw new Error("FSV04 durable readiness or inactive boundary is wrong.");

  const storedReceipt = await lane.persistence.query<{
    frame_bytes: Uint8Array;
  }>("select frame_bytes from fx_system_declarative_v2_verdict");
  const originalReceiptBytes = storedReceipt.rows[0]?.frame_bytes;
  if (originalReceiptBytes === undefined) {
    throw new Error("FSV04 stored receipt bytes are missing.");
  }
  const corruptReceiptBytes = new Uint8Array(originalReceiptBytes);
  corruptReceiptBytes[corruptReceiptBytes.byteLength - 1] ^= 1;
  await lane.persistence.query(
    "update fx_system_declarative_v2_verdict set frame_bytes = $1",
    [corruptReceiptBytes],
  );
  const corruptReplay = await Effect.runPromise(Effect.exit(settle()));
  if (Exit.isSuccess(corruptReplay)) {
    throw new Error("FSV04 accepted corrupt durable receipt bytes.");
  }
  await lane.persistence.query(
    "update fx_system_declarative_v2_verdict set frame_bytes = $1",
    [originalReceiptBytes],
  );

  await lane.persistence.query(
    `update fx_system_index_build_state set lifecycle = 'validating'`,
  );
  const invalidatedBuild = await Effect.runPromise(settle());
  if (
    invalidatedBuild.status !== "not_ready" ||
    invalidatedBuild.reason !== "physicalBuildNotEnabled"
  ) throw new Error("FSV04 did not invalidate readiness after build change.");
  await lane.persistence.query(
    `update fx_system_index_build_state set lifecycle = 'enabled'`,
  );

  await lane.persistence.query(
    `update fx_system_scope_clock
        set epoch = $2
      where scope_id = $1`,
    [registered.scopeId, "epoch_f4000000-0000-4000-8000-000000000099"],
  );
  const stale = await Effect.runPromise(Effect.exit(Effect.scoped(
    settleApplicationRevisionReadinessV1(
      registered.registered.revisionId,
      readinessContext(
        registered.deploymentId,
        lane.persistence,
        lane.makeReadinessTarget(),
        runtimeArtifacts,
      ),
    ),
  )));
  if (Exit.isSuccess(stale)) {
    throw new Error("FSV04 accepted a receipt after scope-epoch invalidation.");
  }
  const postgresVersion = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
        "select version() as version",
      )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    notReadyReasons: [
      "physicalBuildMissing",
      "physicalBuildNotEnabled",
    ] as const,
    buildLifecycles: Object.freeze(buildLifecycles),
    rollbackBoundaries,
    concurrentDispositions: ["inserted", "replayed"] as const,
    coldReplayDisposition: "replayed",
    decisionUncertainDisposition: "replayed",
    decisionUncertaintyInjected: true,
    coldAuthorityFailures: [
      "missingGroup",
      "projectionMismatch",
    ] as const,
    buildStateInvalidation: true,
    receiptCorruptionRejected: true,
    staleInvalidation: true,
    verdictCount: rows.verdictCount,
    activeRevisionCount: rows.activeRevisionCount,
    activeHeadCount: rows.activeHeadCount,
    attemptLifecycle: "ready",
    postgresVersion,
  });
}

type ColdMaterializationMode =
  | "normal"
  | "failIfProbed"
  | "missing"
  | "projectionMismatch";

interface ReadinessContextOptions {
  readonly mode?: ColdMaterializationMode;
  readonly beforeProbe?: () => Promise<void>;
}

export function readinessContext(
  deploymentId: string,
  persistence: Persistence,
  target: LocatedApplicationRevisionReadinessTargetV1,
  runtimeArtifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
  options: ReadinessContextOptions = {},
): ApplicationRevisionReadinessContextV1<unknown> {
  const mode = options.mode ?? "normal";
  let materializationSequence = 0;
  return Object.freeze({
    deploymentId,
    controlDb: persistence.drizzle,
    authority: authorityPorts(persistence, target),
    coldMaterialization: {
      probe: (publication: LoadedCandidateRuntimePublicationV1) =>
        mode === "failIfProbed"
          ? Effect.die(new Error("FSV04 cold replay reran materialization."))
          : Effect.tryPromise({
              try: async () => options.beforeProbe?.(),
              catch: cause => cause,
            }).pipe(Effect.flatMap(() => probeDeclarativeV2ColdMaterializationV1({
              candidate: publication.candidate,
              candidateSha256: publication.candidateSha256,
              publication: publication.publication,
              budget: COLD_BUDGET,
            }, runtimeArtifacts.store, {
              identity: "flarex.test/cold-materializer/fsv04-v1",
              materialize: request => Effect.sync(() => Object.freeze({
                compressedByteLength: request.modules.reduce(
                  (sum, module) =>
                    sum + new TextEncoder().encode(module.code).byteLength,
                  0,
                ),
                startupMilliseconds: ++materializationSequence,
              })),
            }).pipe(Effect.map(receipts => {
              const projected = receipts.map(receipt => Object.freeze({
                codecIdentity: receipt.codecIdentity,
                group: receipt.frame.group,
                sha256: receipt.sha256,
                canonicalBytes: receipt.canonicalBytes,
              }));
              if (mode === "missing") {
                return Object.freeze(projected.slice(1));
              }
              if (mode !== "projectionMismatch" || receipts.length === 0) {
                return Object.freeze(projected);
              }
              const first = receipts[0]!;
              const mismatchedFrame = Object.freeze({
                ...first.frame,
                projectionSha256: new Uint8Array(32).fill(0xee),
              });
              const encoded = Result.getOrThrow(
                encodeDeclarativeV2PhysicalFrameV1(
                  mismatchedFrame,
                  Object.freeze({
                    maximumFrameBytes: 64 * 1_048_576,
                    maximumCanonicalBytes: 64 * 1_048_576,
                  }),
                ),
              );
              const digest = new Uint8Array(
                createHash("sha256").update(encoded.canonicalBytes).digest(),
              );
              return Object.freeze([
                Object.freeze({
                  codecIdentity: first.codecIdentity,
                  group: first.frame.group,
                  sha256: digest,
                  canonicalBytes: encoded.canonicalBytes,
                }),
                ...projected.slice(1),
              ]);
            })))),
    },
  });
}

function makeTwoPartyMaterializationBarrier() {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });
  return Object.freeze({
    arrive: async () => {
      arrivals += 1;
      if (arrivals === 2) release?.();
      await ready;
    },
  });
}

export function authorityPorts(
  persistence: Persistence,
  target: LocatedApplicationRevisionReadinessTargetV1,
) {
  return Object.freeze({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("FSV04 shared scope must not read split receipts.");
      },
    },
    scopeClockTargets: { resolve: async () => target },
  });
}

async function readinessRows(persistence: Persistence) {
  const [verdict, attempt, activeRevision, activeHead] = await Promise.all([
    persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_declarative_v2_verdict",
    ),
    persistence.query<{ lifecycle: string }>(
      "select lifecycle from fx_system_declarative_v2_verifier_attempt_v2",
    ),
    persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_declarative_v2_activation_revision",
    ),
    persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_declarative_v2_activation_head",
    ),
  ]);
  return Object.freeze({
    verdictCount: Number(verdict.rows[0]?.count ?? "-1"),
    attemptLifecycle: attempt.rows[0]?.lifecycle ?? "missing",
    activeRevisionCount: Number(activeRevision.rows[0]?.count ?? "-1"),
    activeHeadCount: Number(activeHead.rows[0]?.count ?? "-1"),
  });
}
