import { createHash } from "node:crypto";

import { bytesEqualFullScan } from "@flarex/utils/bytes";
import {
  activateApplicationRevisionV1,
  readActiveApplicationRevisionV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  claimDirectActionExecutionV1,
  declareExternalEffectDispatchV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import {
  claimApplicationRevisionActionRuntimeTargetAuthorityV1,
} from "@flarex/persistence-postgres/internal/application-revision-action-runtime-target-v1";
import {
  createPGliteLocatedApplicationActionAuthorityTargetV1,
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/pglite";
import {
  makeExecutionEvidenceBodyStoreV1,
  type ExecutionEvidenceBodyR2BucketV1,
} from "flarex-backend/internal/execution-evidence-body-r2-v1";
import { Effect } from "effect";
import {
  canonicalizeFlarexValueV1,
  decodeCanonicalFlarexValueEvidenceV1,
} from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import { createMigratedPGlitePersistence } from
  "../support/databaseFixturesV1";
import { prepareFsv05ReadyRevisionFixtureV1 } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "../../support/memoryRuntimeArtifactStoreV1";
import { AAV_A1_LOCATOR } from
  "../../support/applicationActionAuthorityV1Harness";
import {
  admitActiveApplicationActionV1,
  completeActiveApplicationActionV1,
  confirmActiveApplicationOutboundHttpEffectV1,
  prepareActiveApplicationOutboundHttpEffectV1,
} from
  "@flarex/standard-application-invocation/internal/action-admission-system-v1";

describe("AAV-A1 active action admission composition", () => {
  it("publishes canonical arguments to R2 before exact active-revision admission", async () => {
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

    const bucket = new MemoryBucket();
    const bodyStore = makeExecutionEvidenceBodyStoreV1(
      bucket,
      { hash: bytes => Effect.sync(() => sha256(bytes)) },
      {
        verify: (_kind, bytes) => Effect.tryPromise({
          try: async () => {
            if (
              _kind === "outbound_http_request" ||
              _kind === "outbound_http_response"
            ) {
              const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
              if (JSON.stringify(JSON.parse(text) as unknown) !== text) {
                throw new Error("noncanonical HTTP evidence body");
              }
              return;
            }
            const canonical = await decodeCanonicalFlarexValueEvidenceV1({
              canonicalBytes: bytes,
              sha256: sha256(bytes),
            });
            if (!bytesEqualFullScan(canonical.canonicalBytes, bytes)) {
              throw new Error("noncanonical action argument body");
            }
          },
          catch: cause => String(cause),
        }),
      },
    );
    const argumentsValue = await canonicalizeFlarexValueV1({ message: "hello" });
    const actionTarget = createPGliteLocatedApplicationActionAuthorityTargetV1(
      persistence,
      AAV_A1_LOCATOR,
    );
    const admitted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const active = yield* readActiveApplicationRevisionV1(ready.context);
      const actionRuntime = yield* claimApplicationRevisionActionRuntimeTargetAuthorityV1(
        active.selection,
        "actions:send",
      );
      const authority = Object.freeze({
        target: actionTarget,
        sha256: { hash: (bytes: Uint8Array) => Effect.sync(() => sha256(bytes)) },
        authority: actionRuntime.scopeAuthority,
      });
      const admissionLive = Object.freeze({
        bodyStore,
        argumentBudget: Object.freeze({
          maximumBodyBytes: 4_096,
          maximumHashBytes: 4_096,
        }),
        authority: Object.freeze({
          target: actionTarget,
          sha256: { hash: (bytes: Uint8Array) => Effect.sync(() => sha256(bytes)) },
        }),
      });
      const input = Object.freeze({
        selection: active.selection,
        functionPath: "actions:send",
        requestKey: "aav-a1:composition",
        invocationId: "00000000-0000-4000-8000-000000000031",
        arguments: argumentsValue,
        executionIdentitySha256: sha256Text("composition:identity"),
        compatibilityDate: "2026-08-04",
        hostPolicySha256: sha256Text("composition:policy"),
      });
      const first = yield* admitActiveApplicationActionV1(input, admissionLive);
      const replay = yield* admitActiveApplicationActionV1({
        ...input,
        invocationId: "00000000-0000-4000-8000-000000000032",
      }, admissionLive);
      const claimed = yield* claimDirectActionExecutionV1(
        input.requestKey,
        60_000,
        sha256Text("composition:random"),
        authority,
      );
      const evidenceLive = Object.freeze({
        bodyStore,
        bodyBudget: admissionLive.argumentBudget,
        authority,
      });
      const effect = yield* prepareActiveApplicationOutboundHttpEffectV1(
        claimed.subject,
        {
          stableEffectKey: "composition:http",
          canonicalRequestBytes: new TextEncoder().encode(
            '{"body":"hello","method":"POST","url":"https://example.invalid"}',
          ),
        },
        evidenceLive,
      );
      yield* declareExternalEffectDispatchV1(
        claimed.subject,
        effect.effectOrdinal,
        authority,
      );
      yield* confirmActiveApplicationOutboundHttpEffectV1(
        claimed.subject,
        effect.effectOrdinal,
        new TextEncoder().encode('{"body":"ok","status":200}'),
        evidenceLive,
      );
      const result = yield* Effect.promise(() =>
        canonicalizeFlarexValueV1({ delivered: true })
      );
      const completed = yield* completeActiveApplicationActionV1(
        claimed.subject,
        result,
        evidenceLive,
      );
      return Object.freeze({ first, replay, completed, effect });
    })));
    expect(admitted.first.disposition).toBe("inserted");
    expect(admitted.replay.disposition).toBe("replayed");
    expect(admitted.replay.invocation.invocationId)
      .toBe(admitted.first.invocation.invocationId);
    expect(admitted.completed.lifecycle).toBe("completed");
    expect(admitted.effect.state).toBe("prepared");
    expect(bucket.bodies.size).toBe(4);
    const rows = await persistence.query<{
      body_columns: string;
      effects: string;
      invocations: string;
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
      invocations: "1",
    }]);
  }, 480_000);
});

class MemoryBucket implements ExecutionEvidenceBodyR2BucketV1 {
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

function sha256Text(value: string): Uint8Array {
  return sha256(new TextEncoder().encode(value));
}
