import { createHash } from "node:crypto";

import { bytesEqualFullScan } from "@flarex/utils/bytes";
import {
  makeEdgeActionRouteIndependentCoordinatorV1,
} from "flarex-backend/internal/edge-action-route-independent-coordinator-v1";
import {
  makeExecutionEvidenceBodyStoreV1,
  type ExecutionEvidenceBodyR2BucketV1,
} from "flarex-backend/internal/execution-evidence-body-r2-v1";
import { Effect, Layer, Result } from "effect";
import {
  EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
} from "flarex-protocol/edge-action-exact-runtime";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  type EdgeActionHostPolicyFrameV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1,
  ExecutionEvidenceProtocolV1Error,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  decodeCanonicalFlarexValueEvidenceV1,
} from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  claimApplicationRevisionActionRuntimeTargetAuthorityV1,
} from "@flarex/persistence-postgres/internal/application-revision-action-runtime-target-v1";
import {
  activateApplicationRevisionV1,
  readActiveApplicationRevisionV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  createPGliteLocatedApplicationActionAuthorityTargetV1,
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/pglite";
import {
  makeLegacyApplicationActionSystemV1Layer,
  invokeLegacyApplicationActionV1,
  type LegacyApplicationActionSystemLiveV1,
} from "@flarex/standard-application-invocation/internal/system-action-v1";
import {
  claimActiveApplicationEdgeActionArtifactHostDispatchV1,
} from
  "@flarex/standard-application-invocation/internal/edge-action-dispatch-capability-bundle-v1";
import {
  makeLegacyStandardApplicationActiveRevisionReaderV1Layer,
} from "@flarex/standard-application-invocation/v1";
import { AAV_A1_LOCATOR } from "../../support/applicationActionAuthorityV1Harness";
import {
  prepareFsv05ReadyRevisionFixtureV1,
} from "../../support/fsv05ApplicationRevisionActivationHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "../../support/memoryRuntimeArtifactStoreV1";

const ACTION_PATH = TransactionFunctionPathV1Schema.make("actions:send");
const REQUEST_KEY = TransactionRequestKeyV1Schema.make("sap07:pglite:complete");
const RECOVERY_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sap07:pglite:recover-no-dispatch",
);
const UNCERTAIN_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sap07:pglite:recover-possible-dispatch",
);
const EVIDENCE_BUDGET = Object.freeze({
  maximumBodyBytes: 1_048_576,
  maximumHashBytes: 1_048_576,
});
const RUNTIME_BUDGET = Object.freeze({
  maximumModules: 64,
  maximumObjects: 128,
  maximumObjectBytes: 16 * 1_048_576,
  maximumRawBytes: 8 * 1_048_576,
  maximumHashBytes: 64 * 1_048_576,
});
const HOST_POLICY_ENCODING_BUDGET = Object.freeze({
  maximumOrigins: 4,
  maximumOriginBytes: 256,
  maximumCanonicalBytes: 16_384,
});

describe("Legacy SAP07 Standard public edge action", () => {
  it("selects the active revision, claims its exact candidate, and durably replays the R2 result", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const activationTarget =
      createPGliteLocatedApplicationRevisionActivationTargetV1(
        persistence,
        AAV_A1_LOCATOR,
      );
    const artifacts = makeMemoryRuntimeArtifactStoreV1();
    const ready = await prepareFsv05ReadyRevisionFixtureV1({
      name: "pglite",
      persistence,
      registrationTarget:
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          AAV_A1_LOCATOR,
        ),
      makeActivationTarget: () => activationTarget,
      makeDecisionUncertainTarget: () => Object.freeze({
        target: activationTarget,
        wasInjected: () => false,
      }),
    }, artifacts, "aav-a1-composition", true);
    await Effect.runPromise(Effect.scoped(activateApplicationRevisionV1(
      ready.revisionId,
      null,
      ready.context,
    )));

    const evidenceBucket = new MemoryEvidenceBucket();
    const bodyStore = makeExecutionEvidenceBodyStoreV1(
      evidenceBucket,
      { hash: bytes => Effect.sync(() => sha256(bytes)) },
      {
        verify: (kind, bytes) => kind === "outbound_http_request"
          ? Effect.void
          : Effect.tryPromise({
              try: async () => {
                const decoded = await decodeCanonicalFlarexValueEvidenceV1({
                  canonicalBytes: bytes,
                  sha256: sha256(bytes),
                });
                if (!bytesEqualFullScan(decoded.canonicalBytes, bytes)) {
                  throw new Error("noncanonical SAP07 evidence body");
                }
              },
              catch: () => new ExecutionEvidenceProtocolV1Error({
                identity: EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1,
                operation: "decode",
                reason: "nonCanonical",
                path: "$body",
              }),
            }),
      },
    );
    const hostPolicy = makeHostPolicy();
    let hostExecutions = 0;
    let executionContexts = 0;
    let hostMode: "success" | "defect" | "dispatchThenDefect" = "success";
    const coordinator = makeEdgeActionRouteIndependentCoordinatorV1({
      run: async bundle => {
        hostExecutions += 1;
        const claim = Result.getOrThrow(
          claimActiveApplicationEdgeActionArtifactHostDispatchV1(bundle),
        );
        expect(claim.request.function.path).toBe(ACTION_PATH);
        expect(claim.request.artifact.sourcePackageHash).toMatch(/^[0-9a-f]{64}$/u);
        expect(claim.request.context.executionId).toMatch(
          /^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$/u,
        );
        if (hostMode === "defect") {
          throw new Error("injected SAP07 pre-dispatch interruption");
        }
        if (hostMode === "dispatchThenDefect") {
          const outboundError = await claim.outbound.fetch(
            "https://api.example.com/uncertain",
          ).then(() => null, cause => cause);
          expect(outboundError).toMatchObject({ phase: "afterDispatch" });
          throw new Error("injected SAP07 post-dispatch interruption");
        }
        return Object.freeze({
          kind: "success" as const,
          result: Object.freeze({
            format: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
            version: EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
            value: Object.freeze({ delivered: true }),
          }),
        });
      },
    });

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const active = yield* readActiveApplicationRevisionV1(ready.context);
      const actionTarget =
        yield* claimApplicationRevisionActionRuntimeTargetAuthorityV1(
          active.selection,
          ACTION_PATH,
        );
      const authorityTarget =
        createPGliteLocatedApplicationActionAuthorityTargetV1(
          persistence,
          AAV_A1_LOCATOR,
        );
      const hash = Object.freeze({
        hash: (bytes: Uint8Array) => Effect.sync(() => sha256(bytes)),
      });
      const authority = Object.freeze({
        target: authorityTarget,
        sha256: hash,
        authority: actionTarget.scopeAuthority,
      });
      const evidence = Object.freeze({
        bodyStore,
        bodyBudget: EVIDENCE_BUDGET,
        authority,
      });
      const live = Object.freeze({
        admission: Object.freeze({
          bodyStore,
          argumentBudget: EVIDENCE_BUDGET,
          authority: Object.freeze({ target: authorityTarget, sha256: hash }),
        }),
        dispatch: Object.freeze({
          authority,
          bodyStore,
          argumentBudget: EVIDENCE_BUDGET,
          runtimeArtifacts: artifacts.store,
          runtimeBudget: RUNTIME_BUDGET,
          hostPolicy,
          compatibilityDate: "2026-08-04",
        }),
        capabilities: Object.freeze({
          evidence,
          runner: Object.freeze({ runPromise: Effect.runPromise }),
          callbackSystem: Object.freeze({
            runQuery: async () => {
              throw new Error("SAP07 complete action made an unexpected query callback.");
            },
            runMutation: async () => {
              throw new Error("SAP07 complete action made an unexpected mutation callback.");
            },
          }),
          outboundHost: Object.freeze({
            fetch: async () => {
              if (hostMode !== "dispatchThenDefect") {
                throw new Error(
                  "SAP07 complete action made an unexpected outbound request.",
                );
              }
              throw new Error("injected SAP07 uncertain outbound transport");
            },
          }),
        }),
        coordinator,
        hostPolicyEncodingBudget: HOST_POLICY_ENCODING_BUDGET,
        executionContextFactory: () => Object.freeze({
          invocationId: `00000000-0000-4000-8000-0000000000${
            (0x77 + executionContexts++).toString(16).padStart(2, "0")
          }`,
          executionDurationMilliseconds: 30_000,
          randomSeed: new Uint8Array(32).fill(7),
          auth: Object.freeze({ kind: "anonymous" as const }),
        }),
      }) satisfies LegacyApplicationActionSystemLiveV1;
      const layer = Layer.merge(
        makeLegacyApplicationActionSystemV1Layer(live),
        makeLegacyStandardApplicationActiveRevisionReaderV1Layer(ready.context),
      );
      const invoke = (key = REQUEST_KEY) => invokeLegacyApplicationActionV1(
        active.selection,
        ACTION_PATH,
        { message: "hello" },
        key,
      ).pipe(Effect.provide(layer));
      const first = yield* invoke();
      const replay = yield* invoke();
      hostMode = "defect";
      const interrupted = yield* Effect.exit(invoke(RECOVERY_REQUEST_KEY));
      expect(interrupted._tag).toBe("Failure");
      yield* Effect.promise(() => persistence.query(
        `update fx_system_application_action_invocation_v1
         set invocation_time = '1999-12-31 23:59:59+00',
             execution_deadline = '2000-01-01 00:00:00+00'
         where request_key = $1`,
        [RECOVERY_REQUEST_KEY],
      ));
      hostMode = "success";
      const recovered = yield* invoke(RECOVERY_REQUEST_KEY);
      hostMode = "dispatchThenDefect";
      const interruptedAfterDispatch = yield* Effect.exit(
        invoke(UNCERTAIN_REQUEST_KEY),
      );
      expect(interruptedAfterDispatch._tag).toBe("Failure");
      if (interruptedAfterDispatch._tag === "Failure") {
        expect(String(interruptedAfterDispatch.cause)).toContain(
          "injected SAP07 post-dispatch interruption",
        );
      }
      const effectState = yield* Effect.promise(() => persistence.query<{
        readonly state: string;
      }>(
        `select state from fx_system_external_effect_attempt_v1
         order by effect_ordinal`,
      ));
      expect(effectState.rows).toEqual([{ state: "uncertain" }]);
      yield* Effect.promise(() => persistence.query(
        `update fx_system_application_action_invocation_v1
         set invocation_time = '1999-12-31 23:59:59+00',
             execution_deadline = '2000-01-01 00:00:00+00'
         where request_key = $1`,
        [UNCERTAIN_REQUEST_KEY],
      ));
      hostMode = "success";
      const uncertain = yield* invoke(UNCERTAIN_REQUEST_KEY);
      return Object.freeze({ first, replay, recovered, uncertain });
    })));

    expect(result.first).toEqual({
      status: "completed",
      disposition: "published",
      invocationId: "00000000-0000-4000-8000-000000000077",
      value: { delivered: true },
    });
    expect(result.replay).toEqual({
      ...result.first,
      disposition: "replayed",
    });
    expect(result.recovered).toMatchObject({
      status: "completed",
      disposition: "published",
    });
    expect(result.uncertain).toMatchObject({
      status: "notCompleted",
      disposition: "replayed",
      lifecycle: "uncertain",
      terminalCode: "execution_expired_after_possible_dispatch",
    });
    expect(hostExecutions).toBe(4);
    const rows = await persistence.query<{
      readonly body_columns: string;
      readonly effects: string;
      readonly invocations: string;
    }>(`select
      (select count(*)::text
       from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'fx_system_application_action_invocation_v1'
         and column_name like '%bytes%') as body_columns,
      (select count(*)::text
       from fx_system_application_action_invocation_v1) as invocations,
      (select count(*)::text
       from fx_system_external_effect_attempt_v1) as effects`);
    expect(rows.rows).toEqual([{
      body_columns: "0",
      effects: "1",
      invocations: "3",
    }]);
    expect(evidenceBucket.bodies.size).toBe(3);
  }, 480_000);
});

class MemoryEvidenceBucket implements ExecutionEvidenceBodyR2BucketV1 {
  readonly bodies = new Map<string, Uint8Array>();

  async put(key: string, value: ArrayBuffer): Promise<unknown> {
    if (this.bodies.has(key)) throw new Error("precondition");
    this.bodies.set(key, new Uint8Array(value.slice(0)));
    return {};
  }

  async get(key: string): Promise<unknown> {
    const bytes = this.bodies.get(key);
    if (bytes === undefined) return null;
    const copy = bytes.slice();
    return Object.freeze({
      size: copy.byteLength,
      arrayBuffer: async () => copy.buffer.slice(0),
    });
  }
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function makeHostPolicy(): EdgeActionHostPolicyFrameV1 {
  return Object.freeze({
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: Object.freeze(["https://api.example.com"]),
    cpuMilliseconds: 1_000,
    wallMilliseconds: 30_000,
    maximumSyscalls: 64,
    maximumOutboundRequests: 16,
    maximumConcurrentOutboundRequests: 4,
    maximumWorkerSubrequests: 64,
    maximumArgumentBytes: 1_048_576,
    maximumResultBytes: 1_048_576,
    maximumCallbackArgumentBytes: 1_048_576,
    maximumCallbackResultBytes: 1_048_576,
    maximumUrlBytes: 8_192,
    maximumMethodBytes: 16,
    maximumHeaderCount: 128,
    maximumHeaderBytes: 65_536,
    maximumStatusTextBytes: 1_024,
    maximumOutboundRequestBodyBytes: 1_048_576,
    maximumOutboundResponseBodyBytes: 8 * 1_048_576,
    maximumCumulativeOutboundBodyBytes: 16 * 1_048_576,
    cleanupDrainMilliseconds: 5_000,
    allowRunQuery: true,
    allowRunMutation: true,
    allowRunAction: false,
    allowRedirects: false,
    allowStreaming: false,
    allowAmbientCredentials: false,
    fixedInvocationTime: true,
    deterministicRandom: true,
    allowNondeterministicCrypto: false,
  });
}
