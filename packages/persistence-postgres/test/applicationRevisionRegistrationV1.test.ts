import { webcrypto } from "node:crypto";
import {
  prepareStandardApplicationDefinitionV1,
  type PreparedStandardApplicationDefinitionV1,
  type StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import {
  withAuthenticatedApplicationRevisionEvidenceTestDriverV1,
  type AuthenticatedApplicationRevisionEvidenceTestDriverV1,
  type DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
} from
  "../../flarex-backend/test/authenticatedApplicationRevisionEvidenceFixture";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Result } from "effect";
import {
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2FunctionGroupEntryFrameV1,
  type DeclarativeV2FunctionGroupManifestFrameV1,
  type DeclarativeV2RuntimeProjectionFrameV1,
  type DeclarativeV2RuntimeProjectionModuleFrameV1,
  type DeclarativeV2RuntimeProjectionSetFrameV1,
  type DeclarativeV2RegistrationFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { beforeAll, describe, expect, it } from "vitest";

import {
  type LocatedApplicationRevisionRegistrationTargetV1,
  makeApplicationRevisionRegistrationContextV1,
  ApplicationRevisionRegistrationEvidenceV1Error,
  type ApplicationRevisionCandidateEvidenceProjectionV1,
  type ApplicationRevisionRegistrationCommandReceiptV1,
  type ApplicationRevisionRegistrationEvidenceAuthorityV1,
  type PrivateApplicationRevisionAnalysisPreparationV1,
} from "../src/applicationRevisionRegistrationV1";
import {
  makeDeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryV2,
} from "../src/declarativeV2VerifierProgressRepositoryV2";
import {
  type CandidateRuntimeArtifactPublisherV1,
  type CandidateRuntimePublicationV1,
  type CandidateRuntimePublishedAuthorityV1,
  type CandidateRuntimeStoredAuthorityV1,
  publishCandidateRuntimeArtifactsV1,
} from "../src/candidateRuntimeProjectionV1";
import {
  makeCandidateRuntimePublicationRepositoryV1,
} from "../src/candidateRuntimePublicationRepositoryV1";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
} from "../src/scopeAuthorityResolution";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "../src/systemTestApplicationRevisionTargetsV1";
import {
  withHistoricalApplicationAnalysisMigrations,
} from "../src/systemTestHistoricalApplicationAnalysisMigrations";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  makeRuntimeArtifactPublisherFixtureV1,
  type RuntimeArtifactPublisherFixtureV1,
} from "./runtimeArtifactPublisherFixture";
import {
  makePrivateApplicationRevisionRegistrationEvidenceBridgeV1,
} from "../../../apps/analyzer/src/PrivateApplicationRevisionRegistrationEvidence";

const UTF8 = new TextEncoder();
const LOCATOR = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "primary",
  schemaName: "public",
});
const DEPLOYMENT_ID = "deployment_registration_v1";
const PROJECT_ID = "project_registration_v1";
const SCOPE_ID = ScopeIdSchema.make(
  "scope_61000000-0000-0000-0000-000000000001",
);
const EPOCH = "epoch_61000000-0000-0000-0000-000000000002";
const OPERATION_BUDGET = Object.freeze({
  maximumCalls: 64,
  maximumRows: 64,
  maximumFrameBytes: 16 * 1_048_576,
  maximumCanonicalBytes: 16 * 1_048_576,
  maximumHashBytes: 16 * 1_048_576,
  maximumElapsedMilliseconds: 60_000,
});
const PROGRESS_OPTIONS = Object.freeze({
  claimDurationMilliseconds: 60_000,
  randomUuid: () => "11111111-1111-4111-8111-111111111111",
  monotonicMilliseconds: () => 0,
});

const registrationFixtureImportState = globalThis as typeof globalThis & {
  __flarexRegistrationFixtureOnlyV1?: boolean;
};

if (registrationFixtureImportState.__flarexRegistrationFixtureOnlyV1 !== true) {
describe("inactive application revision registration V1", () => {
  beforeAll(() => {
    if (globalThis.crypto === undefined) {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto,
      });
    }
  });

  it("registers atomically, replays concurrently, and cold-reloads DB time", async () => {
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* registrationFixture();
      const first = yield* fixture.context.register(
        fixture.analysis,
        "request:orders:v1",
      );
      expect(first.kind).toBe("registered");
      expect(first.status).toBe("inactive");
      expect(first.revisionId).toBe(
        `dv2_${encodeBytesToLowercaseHex(fixture.preparation.candidateSha256)}`,
      );
      expect(first.registeredAt).toBeInstanceOf(Date);

      const concurrent = yield* Effect.all([
        fixture.context.register(fixture.analysis, "request:orders:v1"),
        fixture.context.register(fixture.analysis, "request:orders:v2"),
      ], { concurrency: 2 });
      expect(concurrent.map((item) => item.kind))
        .toEqual(["replayed", "replayed"]);
      expect(concurrent[0].registeredAt.getTime())
        .toBe(first.registeredAt.getTime());
      expect(concurrent[1].registeredAt.getTime())
        .toBe(first.registeredAt.getTime());

      const cold = makeRegistrationTestContext(
        fixture.persistence,
        fixture.target,
        fixture.evidenceAuthority.authority,
      );
      const coldPreparation = yield* cold.prepareAnalysis({
        preparedDefinition: fixture.preparedDefinition,
        authenticatedEvidence: fixture.candidateAuthority,
        attemptCeilings: fixture.attemptCeilings,
      });
      expect(coldPreparation.candidateSha256)
        .toEqual(fixture.preparation.candidateSha256);
      expect(coldPreparation.attemptSha256)
        .toEqual(fixture.preparation.attemptSha256);
      const runtimePublication = yield*
        makeCandidateRuntimePublicationRepositoryV1(fixture.target).load(
          SCOPE_ID,
          coldPreparation.candidateSha256,
        );
      expect(runtimePublication.candidate.readinessPolicyIdentity).toBe(
        "flarex.readiness/runtime-projection-cold-materialization/v1",
      );
      expect(runtimePublication.publication.projections).toHaveLength(1);
      expect(runtimePublication.publication.projections[0]?.frame.group)
        .toBe("transaction");
      expect(runtimePublication.publication.functionEntries).toHaveLength(1);
      expect(runtimePublication.publication.functionEntries[0]?.frame.functionPath)
        .toBe("orders:place");
      yield* cold.correlateAnalysis(
        coldPreparation,
        fixture.analysis,
        fixture.evidenceAuthority.issueCommand(
          coldPreparation,
          fixture.commandReceipt,
        ),
      );
      const reloaded = yield* cold.register(
        fixture.analysis,
        "request:orders:v1",
      );
      expect(reloaded.kind).toBe("replayed");
      expect(reloaded.registeredAt.getTime())
        .toBe(first.registeredAt.getTime());
      const revisionRows = yield* Effect.promise(() =>
        fixture.persistence.query<{
          status: string;
          registered_at: string;
        }>(
          `select status, registered_at
           from fx_system_application_revision_v1
           where scope_id = $1`,
          [SCOPE_ID],
        )
      );
      const requestRows = yield* Effect.promise(() =>
        fixture.persistence.query<{ request_key: string }>(
          `select request_key
           from fx_system_application_revision_request_v1
           where scope_id = $1
           order by request_key`,
          [SCOPE_ID],
        )
      );
      expect(revisionRows.rows).toHaveLength(1);
      expect(revisionRows.rows[0]?.status).toBe("inactive");
      expect(requestRows.rows.map((row) => row.request_key)).toEqual([
        "request:orders:v1",
        "request:orders:v2",
      ]);
    })));
  });

  it("registers through backend-owned opaque evidence and its exact command receipt", async () => {
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const persistence = yield* Effect.promise(
        createHistoricalApplicationAnalysisPGlitePersistence,
      );
      const target =
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          LOCATOR,
        );
      const fixture = yield* authenticatedRegistrationFixtureForPersistence(
        persistence,
        target,
      );
      const first = yield* fixture.context.register(
        fixture.analysis,
        "request:authenticated:v1",
      );
      const replay = yield* fixture.context.register(
        fixture.analysis,
        "request:authenticated:v1",
      );
      const clonedCandidate = yield* Effect.flip(
        fixture.context.prepareAnalysis({
          preparedDefinition: fixture.preparedDefinition,
          authenticatedEvidence: Object.freeze({
            ...fixture.authenticatedEvidence,
          }),
          attemptCeilings: fixture.attemptCeilings,
        }),
      );

      expect(first.kind).toBe("registered");
      expect(replay.kind).toBe("replayed");
      expect(replay.registeredAt.getTime()).toBe(first.registeredAt.getTime());
      expect(clonedCandidate).toMatchObject({
        _tag: "ApplicationRevisionRegistrationEvidenceV1Error",
        reason: "authorityChanged",
        path: "candidateAuthority",
      });
    })));
  });

  it("rejects uncorrelated structural results and contradictory request keys", async () => {
    const result = await runEffect(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* registrationFixture();
      const forged = Object.freeze({
        ...fixture.analysis,
        result: Object.freeze({ ...fixture.analysis.result }),
      });
      const forgedFailure = yield* Effect.flip(
        fixture.context.register(forged, "request:forged"),
      );
      yield* fixture.context.register(
        fixture.analysis,
        "request:conflict",
      );
      yield* Effect.promise(() =>
        fixture.persistence.query(
          `update fx_system_application_revision_request_v1
           set registration_input_sha256 = $3
           where scope_id = $1 and request_key = $2`,
          [SCOPE_ID, "request:conflict", digest(0xfe)],
        )
      );
      const conflict = yield* Effect.flip(fixture.context.register(
        fixture.analysis,
        "request:conflict",
      ));
      return { forgedFailure, conflict };
    })));
    expect(result.forgedFailure).toMatchObject({
      _tag: "ApplicationRevisionRegistrationContextV1Error",
      reason: "unrecognizedAnalysis",
    });
    expect(result.conflict).toMatchObject({
      _tag: "ApplicationRevisionRegistrationRequestConflictV1Error",
      reason: "requestKeyReuse",
      scopeId: SCOPE_ID,
    });
  });

  it("rejects cloned authorities and atomically claims correlation", async () => {
    const result = await runEffect(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* registrationFixture(false);
      const candidateCloneFailure = yield* Effect.flip(
        fixture.context.prepareAnalysis({
          preparedDefinition: fixture.preparedDefinition,
          authenticatedEvidence: Object.freeze({
            ...fixture.candidateAuthority,
          }),
          attemptCeilings: fixture.attemptCeilings,
        }),
      );
      const clonedAnalysis = Object.freeze({
        ...fixture.analysis,
        result: Object.freeze({ ...fixture.analysis.result }),
      });
      const commandAuthority =
        fixture.evidenceAuthority.issueCommand(
          fixture.preparation,
          fixture.commandReceipt,
        );
      const commandCloneFailure = yield* Effect.flip(
        fixture.context.correlateAnalysis(
          fixture.preparation,
          fixture.analysis,
          Object.freeze({ ...commandAuthority }),
        ),
      );
      const reservationForgeryFailure = yield* Effect.flip(
        fixture.context.correlateAnalysis(
          fixture.preparation,
          fixture.analysis,
          fixture.evidenceAuthority.issueCommand(
            fixture.preparation,
            Object.freeze({
              ...fixture.commandReceipt,
              freshAuthenticatedInputSha256: digest(0xfd),
            }),
          ),
        ),
      );
      const exits = yield* Effect.all([
        Effect.exit(fixture.context.correlateAnalysis(
          fixture.preparation,
          fixture.analysis,
          fixture.evidenceAuthority.issueCommand(
            fixture.preparation,
            fixture.commandReceipt,
          ),
        )),
        Effect.exit(fixture.context.correlateAnalysis(
          fixture.preparation,
          clonedAnalysis,
          fixture.evidenceAuthority.issueCommand(
            fixture.preparation,
            fixture.commandReceipt,
          ),
        )),
      ], { concurrency: 2 });
      return {
        candidateCloneFailure,
        commandCloneFailure,
        reservationForgeryFailure,
        exits,
      };
    })));
    expect(result.candidateCloneFailure).toMatchObject({
      _tag: "ApplicationRevisionRegistrationEvidenceV1Error",
      path: "candidateAuthority",
    });
    expect(result.commandCloneFailure).toMatchObject({
      _tag: "ApplicationRevisionRegistrationEvidenceV1Error",
      path: "commandAuthority",
    });
    expect(result.reservationForgeryFailure).toMatchObject({
      _tag: "ApplicationRevisionRegistrationEvidenceV1Error",
      reason: "terminalCommandMismatch",
    });
    expect(result.exits.filter(Exit.isSuccess)).toHaveLength(1);
    const failure = result.exits.find(Exit.isFailure);
    expect(failure).toBeDefined();
    if (failure !== undefined && Exit.isFailure(failure)) {
      expect(Cause.squash(failure.cause)).toMatchObject({
        _tag: "ApplicationRevisionRegistrationContextV1Error",
        reason: "alreadyCorrelated",
      });
    }
  });

  it("rolls schema publication and revision evidence back with the receipt", async () => {
    const result = await runEffect(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* registrationFixture();
      yield* Effect.promise(() => fixture.persistence.exec(`
        create function fx_test_reject_revision_request_v1()
        returns trigger language plpgsql as $$
        begin
          raise exception 'forced request receipt failure';
        end;
        $$;
        create trigger fx_test_reject_revision_request_v1
        before insert on fx_system_application_revision_request_v1
        for each row execute function fx_test_reject_revision_request_v1();
      `));
      const failure = yield* Effect.flip(fixture.context.register(
        fixture.analysis,
        "request:rollback",
      ));
      const revisions = yield* Effect.promise(() =>
        fixture.persistence.query<{ count: string }>(
          `select count(*)::text as count
           from fx_system_application_revision_v1`,
        )
      );
      const schemas = yield* Effect.promise(() =>
        fixture.persistence.query<{ count: string }>(
          `select count(*)::text as count
           from fx_control_schema_version
           where deployment_id = $1`,
          [DEPLOYMENT_ID],
        )
      );
      return {
        failure,
        revisionCount: revisions.rows[0]?.count,
        schemaCount: schemas.rows[0]?.count,
      };
    })));

    expect(result.failure).toMatchObject({
      _tag: "ApplicationRevisionRegistrationConfirmedRollbackV1Error",
      retryable: false,
    });
    expect(result.revisionCount).toBe("0");
    expect(result.schemaCount).toBe("0");
  });

  it("fails closed when a reloaded runtime object reference is corrupted", async () => {
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* registrationFixture();
      yield* Effect.promise(() => fixture.persistence.query(
        `update fx_system_declarative_v2_runtime_projection_module
         set object_key = object_key || '-forged'
         where scope_id = $1`,
        [SCOPE_ID],
      ));
      const result = yield* Effect.result(
        makeCandidateRuntimePublicationRepositoryV1(fixture.target).load(
          SCOPE_ID,
          fixture.preparation.candidateSha256,
        ),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "CandidateRuntimePublicationStorageV1Error",
          operation: "load",
          reason: "corruption",
        });
      }
    })));
  });

  it("stores only candidate-bound R2 references and normalized mappings", async () => {
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* registrationFixture();
      const loaded = yield*
        makeCandidateRuntimePublicationRepositoryV1(fixture.target).load(
          SCOPE_ID,
          fixture.preparation.candidateSha256,
        );
      expect(loaded.publication.projectionSetReference.objectKey)
        .toContain("declarative-v2-runtime-artifact/v1/runtime-projection-set/");
      expect(loaded.publication.projections[0]?.modules[0]?.sourceByteLength)
        .toBeGreaterThan(0n);
      const bodyColumns = yield* Effect.promise(() =>
        fixture.persistence.query<{ column_name: string }>(
          `select column_name
           from information_schema.columns
           where table_name in (
             'fx_system_declarative_v2_runtime_projection',
             'fx_system_declarative_v2_runtime_projection_module',
             'fx_system_declarative_v2_function_group_manifest',
             'fx_system_declarative_v2_function_group_entry'
           ) and column_name in (
             'frame_bytes',
             'projection_set_frame_bytes',
             'manifest_frame_bytes',
             'source_bytes'
           )`,
        )
      );
      expect(bodyColumns.rows).toEqual([]);
    })));
  });

  it("rejects an over-budget runtime publication before the first R2 call", async () => {
    let calls = 0;
    const entry = Object.freeze({
      kind: "function_group_entry" as const,
      functionOrdinal: 0n,
      functionPath: "orders:place",
      executionModule: "orders.js",
      exportName: "place",
      handlerKind: "mutation" as const,
      visibility: "public" as const,
      group: "transaction" as const,
      projectionSha256: new Uint8Array(32),
    });
    const entries = Object.freeze(Array.from({ length: 61 }, (_, index) =>
      Object.freeze({ ...entry, functionOrdinal: BigInt(index) })
    ));
    const failure = await runEffect(Effect.result(
      publishCandidateRuntimeArtifactsV1(
        Object.freeze({
          projections: Object.freeze([]),
          projectionSetFrame: Object.freeze({
            kind: "runtime_projection_set" as const,
            groupCount: 0n,
            transactionProjectionSha256: null,
            edgeActionProjectionSha256: null,
          }),
          projectionSetFrameBytes: new Uint8Array([1]),
          runtimeProjectionSetSha256: new Uint8Array(32),
          functionEntries: entries,
          functionEntryBytes: Object.freeze(entries.map(() => new Uint8Array([2]))),
          functionEntrySha256: Object.freeze(entries.map(() => new Uint8Array(32))),
          manifestFrame: Object.freeze({
            kind: "function_group_manifest" as const,
            runtimeProjectionSetSha256: new Uint8Array(32),
            functionCount: BigInt(entries.length),
            functionRootSha256: new Uint8Array(32),
            validatorRootSha256: new Uint8Array(32),
            declaredHandlerSetSha256: new Uint8Array(32),
          }),
          manifestFrameBytes: new Uint8Array([3]),
          functionGroupManifestSha256: new Uint8Array(32),
        }),
        {
          putImmutable: () => {
            calls += 1;
            return Effect.die(new Error("R2 must not be called"));
          },
        },
      ),
    ));
    expect(Result.isFailure(failure)).toBe(true);
    if (Result.isFailure(failure)) {
      expect(failure.failure).toMatchObject({
        _tag: "CandidateRuntimeArtifactPublicationV1Error",
        operation: "preflight",
        reason: "budgetExceeded",
        path: "functionEntries",
      });
    }
    expect(calls).toBe(0);
  });

  it("rolls every SQL publication boundary back while immutable R2 bodies remain replayable", async () => {
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* registrationFixture();
      const repository = makeCandidateRuntimePublicationRepositoryV1(
        fixture.target,
      );
      const loaded = yield* repository.load(
        SCOPE_ID,
        fixture.preparation.candidateSha256,
      );
      const reconstructed = yield* reconstructRuntimePublication(
        loaded.publication,
        fixture.runtimeArtifacts,
      );
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        DEPLOYMENT_ID,
        {
          scopeMetadata: fixture.persistence,
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => {
              throw new Error("Shared runtime publication has no split receipt.");
            },
          },
          scopeClockTargets: { resolve: async () => fixture.target },
        },
      );
      const uncertainTarget = {
        physicalLocator: fixture.target.physicalLocator,
        getCurrentClock: fixture.target.getCurrentClock,
        [RUN_LOCATED_READ_COMMITTED_V1]: <A>() => Promise.reject<A>(
          new LocatedReadCommittedTransactionFailureV1({
            kind: "decisionUncertain",
            settlementCause: new Error("lost runtime-publication commit response"),
          }),
        ),
      } satisfies LocatedReadCommittedAttemptTargetV1;
      const uncertain = yield* Effect.result(
        makeCandidateRuntimePublicationRepositoryV1(uncertainTarget).publish({
          authority: located.authority,
          candidate: loaded.candidate,
          candidateSha256: loaded.candidateSha256,
          candidateFrameBytes: loaded.candidateFrameBytes,
          ...reconstructed,
        }),
      );
      expect(Result.isFailure(uncertain)).toBe(true);
      if (Result.isFailure(uncertain)) {
        expect(uncertain.failure).toMatchObject({
          _tag: "CandidateRuntimePublicationStorageV1Error",
          reason: "decisionUncertain",
        });
      }
      yield* Effect.promise(() => fixture.persistence.exec(`
        delete from fx_system_declarative_v2_function_group_entry;
        delete from fx_system_declarative_v2_function_group_manifest;
        delete from fx_system_declarative_v2_runtime_projection_module;
        delete from fx_system_declarative_v2_runtime_projection;
      `));
      for (const boundary of [
        "candidate",
        "projection",
        "projectionModule",
        "manifest",
        "manifestEntry",
      ] as const) {
        const faulting = makeCandidateRuntimePublicationRepositoryV1(
          fixture.target,
          {
            faultAfter: observed => {
              if (observed === boundary) throw new Error(`fault:${boundary}`);
            },
          },
        );
        const failure = yield* Effect.result(faulting.publish({
          authority: located.authority,
          candidate: loaded.candidate,
          candidateSha256: loaded.candidateSha256,
          candidateFrameBytes: loaded.candidateFrameBytes,
          ...reconstructed,
        }));
        expect(Result.isFailure(failure)).toBe(true);
        const count = yield* runtimePublicationRowCount(fixture.persistence);
        expect(count).toBe(0);
      }
      expect(fixture.runtimeArtifacts.bodies.size).toBeGreaterThan(0);
      const replay = yield* Effect.all([
        repository.publish({
          authority: located.authority,
          candidate: loaded.candidate,
          candidateSha256: loaded.candidateSha256,
          candidateFrameBytes: loaded.candidateFrameBytes,
          ...reconstructed,
        }),
        repository.publish({
          authority: located.authority,
          candidate: loaded.candidate,
          candidateSha256: loaded.candidateSha256,
          candidateFrameBytes: loaded.candidateFrameBytes,
          ...reconstructed,
        }),
      ], { concurrency: 2 });
      expect(replay.every(result => result === "replayed")).toBe(true);
    })));
  });
});
}

function reconstructRuntimePublication(
  stored: CandidateRuntimeStoredAuthorityV1,
  artifacts: RuntimeArtifactPublisherFixtureV1,
) {
  return Effect.gen(function* () {
    const projectionSetObject = yield* artifacts.store.readImmutable(
      stored.projectionSetReference.kind,
      stored.projectionSetReference.sha256,
      { maximumBodyBytes: 64 * 1_048_576, maximumHashBytes: 64 * 1_048_576 },
    );
    const manifestObject = yield* artifacts.store.readImmutable(
      stored.manifestReference.kind,
      stored.manifestReference.sha256,
      { maximumBodyBytes: 64 * 1_048_576, maximumHashBytes: 64 * 1_048_576 },
    );
    const projectionSetFrame = decodeRuntimeFrame(
      projectionSetObject.bytes,
      "runtime_projection_set",
    );
    const manifestFrame = decodeRuntimeFrame(
      manifestObject.bytes,
      "function_group_manifest",
    );
    const projections: CandidateRuntimePublicationV1["projections"][number][] = [];
    const publishedProjections: CandidateRuntimePublishedAuthorityV1["projections"][number][] = [];
    for (const authority of stored.projections) {
      const projectionObject = yield* artifacts.store.readImmutable(
        authority.reference.kind,
        authority.reference.sha256,
        { maximumBodyBytes: 64 * 1_048_576, maximumHashBytes: 64 * 1_048_576 },
      );
      const projectionFrame = decodeRuntimeFrame(
        projectionObject.bytes,
        "runtime_projection",
      );
      const moduleFrames: DeclarativeV2RuntimeProjectionModuleFrameV1[] = [];
      const moduleFrameBytes: Uint8Array[] = [];
      const moduleFrameSha256: Uint8Array[] = [];
      const publishedModules: CandidateRuntimePublishedAuthorityV1["projections"][number]["modules"][number][] = [];
      for (const module of authority.modules) {
        const object = yield* artifacts.store.readImmutable(
          module.reference.kind,
          module.reference.sha256,
          { maximumBodyBytes: 64 * 1_048_576, maximumHashBytes: 64 * 1_048_576 },
        );
        const frame = decodeRuntimeFrame(
          object.bytes,
          "runtime_projection_module",
        );
        moduleFrames.push(frame);
        moduleFrameBytes.push(object.bytes);
        moduleFrameSha256.push(module.reference.sha256);
        publishedModules.push(Object.freeze({
          frame,
          reference: module.reference,
        }));
      }
      projections.push(Object.freeze({
        group: authority.frame.group,
        moduleFrames: Object.freeze(moduleFrames),
        moduleFrameBytes: Object.freeze(moduleFrameBytes),
        moduleFrameSha256: Object.freeze(moduleFrameSha256),
        projectionFrame,
        projectionFrameBytes: projectionObject.bytes,
        projectionSha256: authority.reference.sha256,
      }));
      publishedProjections.push(Object.freeze({
        group: authority.frame.group,
        reference: authority.reference,
        modules: Object.freeze(publishedModules),
      }));
    }
    const functionEntries: DeclarativeV2FunctionGroupEntryFrameV1[] = [];
    const functionEntryBytes: Uint8Array[] = [];
    const functionEntrySha256: Uint8Array[] = [];
    const publishedEntries: CandidateRuntimePublishedAuthorityV1["functionEntries"][number][] = [];
    for (const authority of stored.functionEntries) {
      const object = yield* artifacts.store.readImmutable(
        authority.reference.kind,
        authority.reference.sha256,
        { maximumBodyBytes: 64 * 1_048_576, maximumHashBytes: 64 * 1_048_576 },
      );
      const frame = decodeRuntimeFrame(object.bytes, "function_group_entry");
      functionEntries.push(frame);
      functionEntryBytes.push(object.bytes);
      functionEntrySha256.push(authority.reference.sha256);
      publishedEntries.push(Object.freeze({ frame, reference: authority.reference }));
    }
    return Object.freeze({
      publication: Object.freeze({
        projections: Object.freeze(projections),
        projectionSetFrame,
        projectionSetFrameBytes: projectionSetObject.bytes,
        runtimeProjectionSetSha256: stored.projectionSetReference.sha256,
        functionEntries: Object.freeze(functionEntries),
        functionEntryBytes: Object.freeze(functionEntryBytes),
        functionEntrySha256: Object.freeze(functionEntrySha256),
        manifestFrame,
        manifestFrameBytes: manifestObject.bytes,
        functionGroupManifestSha256: stored.manifestReference.sha256,
      } satisfies CandidateRuntimePublicationV1),
      publishedAuthority: Object.freeze({
        projectionSetReference: stored.projectionSetReference,
        manifestReference: stored.manifestReference,
        projections: Object.freeze(publishedProjections),
        functionEntries: Object.freeze(publishedEntries),
      } satisfies CandidateRuntimePublishedAuthorityV1),
    });
  });
}

function decodeRuntimeFrame<K extends
  | "runtime_projection_set"
  | "function_group_manifest"
  | "runtime_projection"
  | "runtime_projection_module"
  | "function_group_entry"
>(bytes: Uint8Array, expected: K):
  K extends "runtime_projection_set" ? DeclarativeV2RuntimeProjectionSetFrameV1
    : K extends "function_group_manifest" ? DeclarativeV2FunctionGroupManifestFrameV1
    : K extends "runtime_projection" ? DeclarativeV2RuntimeProjectionFrameV1
    : K extends "runtime_projection_module" ? DeclarativeV2RuntimeProjectionModuleFrameV1
    : DeclarativeV2FunctionGroupEntryFrameV1 {
  const frame = Result.getOrThrow(
    decodeDeclarativeV2PhysicalFrameV1(bytes, {
      maximumFrameBytes: 64 * 1_048_576,
      maximumCanonicalBytes: 64 * 1_048_576,
    }),
  ).frame;
  if (frame.kind !== expected) {
    throw new Error(`Expected ${expected}, received ${frame.kind}.`);
  }
  return frame as never;
}

function runtimePublicationRowCount(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
) {
  return Effect.promise(() => persistence.query<{ count: string }>(
    `select (
      (select count(*) from fx_system_declarative_v2_runtime_projection)
      + (select count(*) from fx_system_declarative_v2_runtime_projection_module)
      + (select count(*) from fx_system_declarative_v2_function_group_manifest)
      + (select count(*) from fx_system_declarative_v2_function_group_entry)
    )::text as count`,
  )).pipe(Effect.map(result => Number(result.rows[0]?.count ?? "-1")));
}

function makeTestEvidenceAuthority() {
  const candidates = new WeakMap<
    object,
    Readonly<{
      readonly definition: PreparedStandardApplicationDefinitionV1;
      readonly evidence: ApplicationRevisionCandidateEvidenceProjectionV1;
    }>
  >();
  const commands = new WeakMap<
    object,
    Readonly<{
      readonly preparation: PrivateApplicationRevisionAnalysisPreparationV1;
      readonly receipt: ApplicationRevisionRegistrationCommandReceiptV1;
    }>
  >();
  const invalid = (path: string) =>
    Result.fail(new ApplicationRevisionRegistrationEvidenceV1Error({
      reason: "authenticatedCorrelationMismatch",
      path,
    }));
  const authority: ApplicationRevisionRegistrationEvidenceAuthorityV1 =
    Object.freeze({
      claimCandidate: (
        definition: PreparedStandardApplicationDefinitionV1,
        value: unknown,
      ) => {
        if (typeof value !== "object" || value === null) {
          return invalid("candidateAuthority");
        }
        const state = candidates.get(value);
        return state !== undefined && state.definition === definition
          ? Result.succeed(state.evidence)
          : invalid("candidateAuthority");
      },
      claimCommand: (
        preparation: PrivateApplicationRevisionAnalysisPreparationV1,
        value: unknown,
      ) => {
        if (typeof value !== "object" || value === null) {
          return invalid("commandAuthority");
        }
        const state = commands.get(value);
        return state !== undefined && state.preparation === preparation
          ? Result.succeed(state.receipt)
          : invalid("commandAuthority");
      },
    });
  return Object.freeze({
    authority,
    issueCandidate: (
      definition: PreparedStandardApplicationDefinitionV1,
      evidence: ApplicationRevisionCandidateEvidenceProjectionV1,
    ) => {
      const handle = Object.freeze({});
      candidates.set(handle, Object.freeze({ definition, evidence }));
      return handle;
    },
    issueCommand: (
      preparation: PrivateApplicationRevisionAnalysisPreparationV1,
      receipt: ApplicationRevisionRegistrationCommandReceiptV1,
    ) => {
      const handle = Object.freeze({});
      commands.set(handle, Object.freeze({ preparation, receipt }));
      return handle;
    },
  });
}

function registrationFixture(correlate = true) {
  return Effect.gen(function* () {
    const persistence = yield* Effect.promise(
      createHistoricalApplicationAnalysisPGlitePersistence,
    );
    const target =
      createPGliteLocatedApplicationRevisionRegistrationTargetV1(
        persistence,
        LOCATOR,
      );
    return yield* registrationFixtureForPersistence(
      persistence,
      target,
      correlate,
    );
  });
}

async function createHistoricalApplicationAnalysisPGlitePersistence() {
  return withHistoricalApplicationAnalysisMigrations(async migrationsFolder => {
    const persistence = await createPGlitePersistence({ migrationsFolder });
    await persistence.migrate();
    return persistence;
  });
}

export function registrationFixtureForPersistence(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  target: LocatedApplicationRevisionRegistrationTargetV1,
  correlate = true,
) {
  return Effect.gen(function* () {
  yield* Effect.promise(() => persistence.insertDeploymentMetadata({
    deploymentId: DEPLOYMENT_ID,
    projectId: PROJECT_ID,
  }));
  yield* Effect.promise(() => persistence.insertScopeMetadata({
    scopeId: SCOPE_ID,
    deploymentId: DEPLOYMENT_ID,
    physicalLocator: LOCATOR,
  }));
  yield* Effect.promise(() => persistence.query(
      `insert into fx_system_scope_clock
        (scope_id, storage_generation, storage_generation_fence,
         last_commit_seq, last_outbox_seq, epoch)
       values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
      [SCOPE_ID, EPOCH],
    ));
  const preparedDefinition = Result.getOrThrow(
    prepareStandardApplicationDefinitionV1(definitionInput()),
  );
  const evidence = yield* Effect.promise(() =>
    authenticatedEvidence(preparedDefinition)
  );
  const evidenceAuthority = makeTestEvidenceAuthority();
  const candidateAuthority =
    evidenceAuthority.issueCandidate(preparedDefinition, evidence);
  const attemptCeilings = budget("attempt_ceilings", 10_000n);
  const runtimeArtifacts = makeRuntimeArtifactPublisherFixtureV1();
  const context = makeRegistrationTestContext(
    persistence,
    target,
    evidenceAuthority.authority,
    runtimeArtifacts.publisher,
  );

    const preparation = yield* context.prepareAnalysis({
      preparedDefinition,
      authenticatedEvidence: candidateAuthority,
      attemptCeilings,
    });
    const repository = makeDeclarativeV2VerifierProgressRepositoryV2(
      target,
      PROGRESS_OPTIONS,
    );
    yield* Effect.promise(() => moveAttemptToRegistration(
      persistence,
      preparation,
    ));
    const terminal = yield* settleRegistration(
      repository,
      preparation,
      preparedDefinition,
      evidence,
    );
    if (correlate) {
      yield* context.correlateAnalysis(
        preparation,
        terminal.analysis,
        evidenceAuthority.issueCommand(
          preparation,
          terminal.commandReceipt,
        ),
      );
    }
    return {
      persistence,
      target,
      context,
      preparedDefinition,
      evidence,
      evidenceAuthority,
      candidateAuthority,
      attemptCeilings,
      runtimeArtifacts,
      preparation,
      ...terminal,
    };
  });
}

export function authenticatedRegistrationFixtureForPersistence(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  target: LocatedApplicationRevisionRegistrationTargetV1,
) {
  return Effect.gen(function* () {
    yield* Effect.promise(() => persistence.insertDeploymentMetadata({
      deploymentId: DEPLOYMENT_ID,
      projectId: PROJECT_ID,
    }));
    yield* Effect.promise(() => persistence.insertScopeMetadata({
      scopeId: SCOPE_ID,
      deploymentId: DEPLOYMENT_ID,
      physicalLocator: LOCATOR,
    }));
    yield* Effect.promise(() => persistence.query(
      `insert into fx_system_scope_clock
        (scope_id, storage_generation, storage_generation_fence,
         last_commit_seq, last_outbox_seq, epoch)
       values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
      [SCOPE_ID, EPOCH],
    ));
    const preparedDefinition = Result.getOrThrow(
      prepareStandardApplicationDefinitionV1(definitionInput()),
    );
    return yield*
      withAuthenticatedApplicationRevisionEvidenceTestDriverV1(
        preparedDefinition,
        {
          projectId: PROJECT_ID,
          deploymentId: DEPLOYMENT_ID,
          deploymentCreatedAt: "2026-07-30T00:00:00.000Z",
        },
        driver =>
          Effect.gen(function* () {
            const bridge =
              makePrivateApplicationRevisionRegistrationEvidenceBridgeV1(
                driver.port,
              );
            const authenticatedEvidence = yield* bridge.issue(
              driver.request,
              driver.preparation,
              preparedDefinition,
            );
            const attemptCeilings = budget("attempt_ceilings", 10_000n);
            const runtimeArtifacts = makeRuntimeArtifactPublisherFixtureV1();
            const context = makeRegistrationTestContext(
              persistence,
              target,
              bridge.authority,
              runtimeArtifacts.publisher,
            );
            const preparation = yield* context.prepareAnalysis({
              preparedDefinition,
              authenticatedEvidence,
              attemptCeilings,
            });
            const repository =
              makeDeclarativeV2VerifierProgressRepositoryV2(
                target,
                PROGRESS_OPTIONS,
              );
            yield* Effect.promise(() => moveAttemptToRegistration(
              persistence,
              preparation,
            ));
            const terminal = yield* settleAuthenticatedRegistration(
              repository,
              preparation,
              preparedDefinition,
              {
                bindReservation: driver.bindReservation,
                produceAndBind: reservation =>
                  Effect.gen(function* () {
                    const producerResult = yield* driver.produce(reservation);
                    return yield* bridge.bindCommand(
                      authenticatedEvidence,
                      driver.request,
                      producerResult,
                      preparation,
                    );
                  }),
              },
            );
            if (terminal.commandAuthority === undefined) {
              return yield* Effect.die(
                new Error("Authenticated settlement omitted command authority."),
              );
            }
            yield* context.correlateAnalysis(
              preparation,
              terminal.analysis,
              terminal.commandAuthority,
            );
            return Object.freeze({
              persistence,
              target,
              context,
              preparedDefinition,
              authenticatedEvidence,
              attemptCeilings,
              runtimeArtifacts,
              preparation,
              ...terminal,
            });
          }),
      );
  });
}

export function makeRegistrationTestContext(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  target: LocatedApplicationRevisionRegistrationTargetV1,
  evidenceAuthority: ApplicationRevisionRegistrationEvidenceAuthorityV1,
  runtimeArtifactPublisher: CandidateRuntimeArtifactPublisherV1 =
    makeRuntimeArtifactPublisherFixtureV1().publisher,
) {
  return makeApplicationRevisionRegistrationContextV1({
    authority: {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared registration must not read split receipts.");
        },
      },
      scopeClockTargets: { resolve: async () => target },
    },
    functionMetadataBudget: {
      maximumFunctionsVisited: 16,
      maximumValidatorNodesVisited: 256,
      maximumCanonicalUtf8BytesMaterialized: 64_000,
    },
    progressRepository: PROGRESS_OPTIONS,
    evidenceAuthority,
    runtimeArtifactPublisher,
  });
}

async function moveAttemptToRegistration(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  preparation: PrivateApplicationRevisionAnalysisPreparationV1,
) {
  const progress = {
    kind: "progress_cursor" as const,
    phase: "registration" as const,
    settledSequence: 0n,
    moduleOrdinal: 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: null,
  };
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(progress, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  await persistence.query(
    `update fx_system_declarative_v2_verifier_attempt_v2
     set lifecycle = 'link_complete',
         progress_byte_length = $3,
         progress_sha256 = $4,
         progress_bytes = $5,
         updated_at = now()
     where scope_id = $1 and attempt_sha256 = $2`,
    [
      SCOPE_ID,
      preparation.attemptSha256,
      BigInt(encoded.canonicalBytes.byteLength),
      await sha256(encoded.canonicalBytes),
      encoded.canonicalBytes,
    ],
  );
}

function settleRegistration(
  repository: DeclarativeV2VerifierProgressRepositoryV2,
  preparation: PrivateApplicationRevisionAnalysisPreparationV1,
  prepared: PreparedStandardApplicationDefinitionV1,
  evidence: ApplicationRevisionCandidateEvidenceProjectionV1,
) {
  return Effect.gen(function* () {
    const acquired = yield* repository.acquire(
      SCOPE_ID,
      preparation.attemptSha256,
      OPERATION_BUDGET,
    );
    const commandBudget = budget("command_budget", 1n);
    const commandBudgetEncoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(commandBudget, {
        maximumFrameBytes: 1_000_000,
        maximumCanonicalBytes: 1_000_000,
      }),
    );
    const reservationInput = {
      reservation: {
        kind: "command_reservation" as const,
        attemptSha256: preparation.attemptSha256,
        candidateSha256: preparation.candidateSha256,
        commandKind: "registration_page" as const,
        sequence: 1n,
        currentProgressSha256: acquired.attempt.progressSha256,
        predecessorReceiptSha256: acquired.attempt.lastReceiptSha256,
        commandBudgetSha256:
          yield* Effect.promise(() => sha256(
            commandBudgetEncoded.canonicalBytes,
          )),
        commandInputSha256: digest(0x31),
        freshAuthenticatedInputSha256: digest(0x32),
        analyzerIdentitySha256: evidence.analyzerIdentitySha256,
        verifierIdentitySha256: evidence.verifierIdentitySha256,
        rangeAndPredecessorTailsSha256: digest(0x33),
      },
      commandBudget,
    };
    const reserved = yield* repository.reserveCommand(
      acquired.run,
      reservationInput,
      OPERATION_BUDGET,
    );
    const artifactModulePath =
      prepared.artifactIngressPlan.source.functionEntries[0]!
        .artifactModulePath;
    const moduleOrdinal = prepared.artifactIngressPlan.source.modules
      .findIndex((module) => module.path === artifactModulePath);
    if (moduleOrdinal < 0) {
      throw new Error("Expected materialized function module.");
    }
    const registrationFrame: DeclarativeV2RegistrationFrameV1 = {
      kind: "registration",
      attemptSha256: preparation.attemptSha256,
      registrationOrdinal: 0n,
      handlerIdentitySha256: digest(0x41),
      moduleOrdinal: BigInt(moduleOrdinal),
      exportName: "place",
      functionPath: "orders:place",
      handlerKind: "mutation",
      visibility: "public",
    };
    const registrationBytes = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(registrationFrame, {
        maximumFrameBytes: 1_000_000,
        maximumCanonicalBytes: 1_000_000,
      }),
    ).canonicalBytes;
    const registrationRootSha256 = digest(0x42);
    const settlementInput = yield* Effect.promise(() =>
      makeSettlementInput(
        reserved.reservation,
        registrationRootSha256,
      )
    );
    const settled = yield* repository.settleCommand(
      reserved.work,
      settlementInput,
      OPERATION_BUDGET,
    );
    yield* repository.release(acquired.run, OPERATION_BUDGET);

    const usage = budget("attempt_usage", 1n);
    const analysis = Object.freeze({
      status: "complete" as const,
      kind: "registration_page" as const,
      result: Object.freeze({
        status: "complete" as const,
        capacity: Object.freeze({
          _tag: "DeclarativeV2VerifierRegistrationCapacityV1" as const,
          ...budgetFields(100n),
        }),
        actual: usage,
        registrationFrames: Object.freeze([
          new Uint8Array(registrationBytes),
        ]),
        nextProgress: settled.settlement.nextProgress,
        nextProgressBytes:
          new Uint8Array(settled.settlement.nextProgressBytes),
        outputManifest: settled.settlement.outputManifest,
        outputManifestBytes:
          new Uint8Array(settled.settlement.outputManifestBytes),
        registrationRootSha256:
          new Uint8Array(registrationRootSha256),
        receipt: Object.freeze({
          transitionCount: 1,
          deltaUsage: usage,
          usage,
        }),
      }),
    });
    const commandReceipt: ApplicationRevisionRegistrationCommandReceiptV1 =
      Object.freeze({
        commandKind: "registration_page",
        sequence: reserved.reservation.sequence,
        attemptSha256: preparation.attemptSha256,
        candidateSha256: preparation.candidateSha256,
        reservationSha256:
          new Uint8Array(settled.settlement.reservationSha256),
        requestSha256: digest(0x51),
        canonicalByteLength: 512,
        freshAuthenticatedInputSha256:
          reserved.reservation.freshAuthenticatedInputSha256,
        commandInputSha256: reserved.reservation.commandInputSha256,
        rangeAndPredecessorTailsSha256:
          reserved.reservation.rangeAndPredecessorTailsSha256,
        analyzerIdentitySha256:
          reserved.reservation.analyzerIdentitySha256,
        verifierIdentitySha256:
          reserved.reservation.verifierIdentitySha256,
      });
    return Object.freeze({ analysis, commandReceipt });
  });
}

function settleAuthenticatedRegistration(
  repository: DeclarativeV2VerifierProgressRepositoryV2,
  preparation: PrivateApplicationRevisionAnalysisPreparationV1,
  prepared: PreparedStandardApplicationDefinitionV1,
  authenticated: Readonly<{
    readonly bindReservation:
      AuthenticatedApplicationRevisionEvidenceTestDriverV1[
        "bindReservation"
      ];
    readonly produceAndBind: (
      reservation: DeclarativeV2VerifierCommandReservationFrameV2,
    ) => Effect.Effect<
      unknown,
      DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
      never
    >;
  }>,
) {
  return Effect.gen(function* () {
    const acquired = yield* repository.acquire(
      SCOPE_ID,
      preparation.attemptSha256,
      OPERATION_BUDGET,
    );
    const lineage = Object.freeze({
      attemptSha256: preparation.attemptSha256,
      candidateSha256: preparation.candidateSha256,
      commandKind: "registration_page" as const,
      sequence: 1n,
      currentProgressSha256: acquired.attempt.progressSha256,
      predecessorReceiptSha256: acquired.attempt.lastReceiptSha256,
    });
    const claim = yield* authenticated.bindReservation(lineage);
    const reserved = yield* repository.reserveCommand(
      acquired.run,
      {
        reservation: {
          kind: "command_reservation" as const,
          ...lineage,
          ...claim.commitments,
        },
        commandBudget: claim.commandBudget,
      },
      OPERATION_BUDGET,
    );
    const commandAuthority =
      yield* authenticated.produceAndBind(reserved.reservation);
    const resultingUsage = Object.freeze({
      ...claim.commandBudget,
      kind: "attempt_usage" as const,
    });
    const artifactModulePath =
      prepared.artifactIngressPlan.source.functionEntries[0]!
        .artifactModulePath;
    const moduleOrdinal = prepared.artifactIngressPlan.source.modules
      .findIndex((module) => module.path === artifactModulePath);
    if (moduleOrdinal < 0) {
      throw new Error("Expected materialized function module.");
    }
    const registrationFrame: DeclarativeV2RegistrationFrameV1 = {
      kind: "registration",
      attemptSha256: preparation.attemptSha256,
      registrationOrdinal: 0n,
      handlerIdentitySha256: digest(0x41),
      moduleOrdinal: BigInt(moduleOrdinal),
      exportName: "place",
      functionPath: "orders:place",
      handlerKind: "mutation",
      visibility: "public",
    };
    const registrationBytes = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(registrationFrame, {
        maximumFrameBytes: 1_000_000,
        maximumCanonicalBytes: 1_000_000,
      }),
    ).canonicalBytes;
    const registrationRootSha256 = digest(0x42);
    const settlementInput = yield* Effect.promise(() =>
      makeSettlementInput(
        reserved.reservation,
        registrationRootSha256,
        resultingUsage,
        claim.commandBudget,
      )
    );
    const settled = yield* repository.settleCommand(
      reserved.work,
      settlementInput,
      OPERATION_BUDGET,
    );
    yield* repository.release(acquired.run, OPERATION_BUDGET);

    const usage = resultingUsage;
    const analysis = Object.freeze({
      status: "complete" as const,
      kind: "registration_page" as const,
      result: Object.freeze({
        status: "complete" as const,
        capacity: Object.freeze({
          _tag: "DeclarativeV2VerifierRegistrationCapacityV1" as const,
          ...budgetFields(100n),
        }),
        actual: usage,
        registrationFrames: Object.freeze([
          new Uint8Array(registrationBytes),
        ]),
        nextProgress: settled.settlement.nextProgress,
        nextProgressBytes:
          new Uint8Array(settled.settlement.nextProgressBytes),
        outputManifest: settled.settlement.outputManifest,
        outputManifestBytes:
          new Uint8Array(settled.settlement.outputManifestBytes),
        registrationRootSha256:
          new Uint8Array(registrationRootSha256),
        receipt: Object.freeze({
          transitionCount: 1,
          deltaUsage: usage,
          usage,
        }),
      }),
    });
    return Object.freeze({ analysis, commandAuthority });
  });
}

async function makeSettlementInput(
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  registrationRootSha256: Uint8Array,
  resultingUsage = budget("attempt_usage", 1n),
  commandUsage = budget("command_budget", 1n),
) {
  const reservationSha256 = await progressFrameSha256(reservation);
  const nextProgress: DeclarativeV2VerifierProgressCursorFrameV2 = {
    kind: "progress_cursor",
    phase: "verdict",
    settledSequence: reservation.sequence,
    moduleOrdinal: 1n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: reservation.predecessorReceiptSha256,
  };
  const nextProgressSha256 = await progressFrameSha256(nextProgress);
  const outputManifest:
    DeclarativeV2VerifierCommandOutputManifestFrameV2 = {
      kind: "command_output_manifest",
      reservationSha256,
      commandKind: "registration_page",
      sequence: reservation.sequence,
      evidenceRootSha256: registrationRootSha256,
      evidenceCount: 1n,
      diagnosticsRootSha256: digest(0x43),
      diagnosticCount: 0n,
      nextProgressSha256,
    };
  const receipt: DeclarativeV2VerifierCommandReceiptFrameV2 = {
    kind: "command_receipt",
    reservationSha256,
    commandUsageSha256: await progressFrameSha256(commandUsage),
    resultingAttemptUsageSha256: await progressFrameSha256(resultingUsage),
    outputManifestSha256: await progressFrameSha256(outputManifest),
    nextProgressSha256,
  };
  return {
    outputManifest,
    commandUsage,
    resultingUsage,
    nextProgress,
    receipt,
  };
}

async function authenticatedEvidence(
  prepared: PreparedStandardApplicationDefinitionV1,
): Promise<ApplicationRevisionCandidateEvidenceProjectionV1> {
  return {
    projectId: PROJECT_ID,
    deploymentId: DEPLOYMENT_ID,
    deploymentCreatedAt: "2026-07-30T00:00:00.000Z",
    sourceRootSha256: digest(0x11),
    sourceSelectorSha256: digest(0x12),
    semanticRootSha256: digest(0x13),
    semanticSelectorSha256: digest(0x14),
    semanticAttemptIdentitySha256: digest(0x15),
    sourceModules: await Promise.all(
      prepared.artifactIngressPlan.source.modules.map(
        async (module, ordinal) => Object.freeze({
          ordinal,
          artifactModulePath: module.path,
          roles: module.roles,
          sourceByteLength: module.sourceBytes.byteLength,
          sourceSha256: await sha256(module.sourceBytes),
        }),
      ),
    ),
    semanticByteLength:
      prepared.artifactIngressPlan.semantic.bytes.byteLength,
    semanticStreamSha256:
      await sha256(prepared.artifactIngressPlan.semantic.bytes),
    semanticModelIdentity: "flarex.declarative-v2",
    semanticCodecIdentity: "flarex.semantic-artifact-v1/ndjson-v1",
    semanticPolicyIdentity: "flarex.standard-application/v1",
    coreLanguageIdentity: "javascript",
    abiIdentity: "flarex.dynamic-worker/v1",
    grammarIdentity: "ecmascript",
    unicodeIdentity: "unicode-15.1",
    parserTableIdentity: "flarex.parser/v1",
    analyzerIdentitySha256: digest(0x21),
    verifierIdentitySha256: digest(0x22),
    deploymentAnalysisCodecIdentity: "flarex.deployment-analysis/v1",
    deploymentAnalysisByteLength: 10n,
    deploymentAnalysisSha256: digest(0x23),
    deploymentCodegenAnalysisCodecIdentity:
      "flarex.deployment-codegen-analysis/v1",
    deploymentCodegenAnalysisByteLength: 11n,
    deploymentCodegenAnalysisSha256: digest(0x24),
  };
}

function definitionInput(): StandardApplicationDefinitionInputV1 {
  return {
    programBudgetInput: {
      maximumModules: 2,
      maximumFunctions: 2,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 256,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: "orders",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                status: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
          },
        }],
        indexes: [{
          tableLogicalName: "orders",
          descriptor: "by_status",
          fields: ["status"],
        }],
      },
      modules: [{
        modulePath: "orders",
        functions: [{
          exportName: "place",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 2,
      maximumEntryBindings: 1,
      maximumSourceBytes: 2_048,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: 32_000,
      maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 16_000,
    },
    graphInput: {
      modules: [
        {
          path: "orders.js",
          roles: ["function"],
          sourceBytes: UTF8.encode("export const place = 1;\n"),
          sourceMapBytes: null,
        },
        {
          path: "_flarex/execution.js",
          roles: ["execution"],
          sourceBytes: UTF8.encode("export const run = 1;\n"),
          sourceMapBytes: null,
        },
      ],
      functionEntries: [{
        logicalModulePath: "orders",
        artifactModulePath: "orders.js",
      }],
      executionPath: "_flarex/execution.js",
      schemaPath: null,
      authPath: null,
    },
  };
}

function budget<Kind extends DeclarativeV2VerifierBudgetFrameV2["kind"]>(
  kind: Kind,
  value: bigint,
): DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: Kind } {
  return Object.freeze({ kind, ...budgetFields(value) });
}

function budgetFields(value: bigint) {
  return Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
      dimension,
      value,
    ]),
  ) as Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >;
}

async function progressFrameSha256(
  frame: Parameters<typeof encodeDeclarativeV2VerifierProgressFrameV2>[0],
) {
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(frame, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return sha256(encoded.canonicalBytes);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes));
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
