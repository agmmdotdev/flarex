import { Result, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  fromCurrentRunAttemptState,
  fromCurrentTaskAttemptGrant,
  fromCurrentTaskRequestedEffect,
  toCurrentRunAttemptState,
  toCurrentTaskAttemptGrant,
  toCurrentTaskRequestedEffect,
} from "../src/runAttempt/DefinitionReference.js";
import type {
  ApplicationRunAttemptStateV1,
  ApplicationTaskAttemptGrantV1,
  ApplicationTaskRequestedEffectV1,
  CurrentRunAttemptState,
  CurrentTaskAttemptGrant,
  CurrentTaskRequestedEffect,
} from "../src/runAttempt/Model.js";
import {
  ApplicationRunAttemptStateV1Schema,
  ApplicationTaskAttemptGrantV1Schema,
  ApplicationTaskRequestedEffectV1Schema,
  RunAttemptStateV1Schema,
  TaskAttemptGrantV1Schema,
  TaskRequestedEffectV1Schema,
  decodeApplicationRunAttemptStateV1,
  decodeApplicationTaskAttemptGrantV1,
  decodeApplicationTaskRequestedEffectV1,
} from "../src/runAttempt/Schema.js";
import {
  ATTEMPT_ID,
  ATTEMPT_NUMBER_1,
  COMPUTE_SMALL,
  DEFINITION_ID,
  FENCE_1,
  LEASE_VERSION_1,
  NOW,
  RUN_ID,
  RUN_VERSION_1,
  cancellationGeneration,
  databaseTime,
} from "./support.js";

const TARGET = new Uint8Array(32).fill(0x71);
const STRICT = { onExcessProperty: "error" } as const;

describe("current task definition lifecycle contracts", () => {
  it("preserves the exact Legacy state, grant, and effect codecs", () => {
    const legacyState = legacyReadyState();
    const legacyGrant = legacyAttemptGrant();
    const legacyEffect = legacyDispatchEffect();

    const encodedState = Result.getOrThrow(Schema.encodeUnknownResult(
      RunAttemptStateV1Schema,
      STRICT,
    )(legacyState));
    const encodedGrant = Result.getOrThrow(Schema.encodeUnknownResult(
      TaskAttemptGrantV1Schema,
      STRICT,
    )(legacyGrant));
    const encodedEffect = Result.getOrThrow(Schema.encodeUnknownResult(
      TaskRequestedEffectV1Schema,
      STRICT,
    )(legacyEffect));

    expect(encodedState).toEqual({
      ...legacyState,
      runVersion: "1",
      cancellation: { kind: "not_requested", generation: "0" },
    });
    expect(encodedGrant).toEqual({
      ...legacyGrant,
      acceptedRunVersion: "1",
      attempt: { ...legacyGrant.attempt, executionFence: "1" },
      lease: { ...legacyGrant.lease, version: "1" },
    });
    expect(encodedEffect).toEqual({
      ...legacyEffect,
      acceptedRunVersion: "1",
      attempt: { ...legacyEffect.attempt, executionFence: "1" },
      leaseVersion: "1",
    });

    expect(Result.isFailure(Schema.decodeUnknownResult(
      ApplicationRunAttemptStateV1Schema,
      STRICT,
    )(encodedState))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(
      ApplicationTaskAttemptGrantV1Schema,
      STRICT,
    )(encodedGrant))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(
      ApplicationTaskRequestedEffectV1Schema,
      STRICT,
    )(encodedEffect))).toBe(true);
  });

  it("round-trips detached Application state and grant references", () => {
    const callerStateTarget = TARGET.slice();
    const callerGrantTarget = TARGET.slice();
    const applicationState = {
      ...withoutLegacy(legacyReadyState()),
      applicationTaskRuntimeTargetSha256: callerStateTarget,
    };
    const applicationGrant = {
      ...withoutLegacy(legacyAttemptGrant()),
      applicationTaskRuntimeTargetSha256: callerGrantTarget,
    };
    const state = Result.getOrThrow(decodeApplicationRunAttemptStateV1(
      Result.getOrThrow(Schema.encodeUnknownResult(
        ApplicationRunAttemptStateV1Schema,
        STRICT,
      )(applicationState)),
    ));
    const grant = Result.getOrThrow(decodeApplicationTaskAttemptGrantV1(
      Result.getOrThrow(Schema.encodeUnknownResult(
        ApplicationTaskAttemptGrantV1Schema,
        STRICT,
      )(applicationGrant)),
    ));

    callerStateTarget.fill(0xff);
    callerGrantTarget.fill(0xff);
    expect(state.applicationTaskRuntimeTargetSha256).toEqual(TARGET);
    expect(grant.applicationTaskRuntimeTargetSha256).toEqual(TARGET);
    const currentState = toCurrentRunAttemptState({
      generation: "application_v1",
      state,
    });
    const currentGrant = toCurrentTaskAttemptGrant({
      generation: "application_v1",
      grant,
    });
    expectTypeOf(currentState).toEqualTypeOf<CurrentRunAttemptState>();
    expectTypeOf(currentGrant).toEqualTypeOf<CurrentTaskAttemptGrant>();
    expect(currentState.definitionReference.generation).toBe("application_v1");
    expect(currentGrant.definitionReference.generation).toBe("application_v1");
    expect(fromCurrentRunAttemptState(currentState)).toEqual({
      generation: "application_v1",
      state,
    });
    expect(fromCurrentTaskAttemptGrant(currentGrant)).toEqual({
      generation: "application_v1",
      grant,
    });
  });

  it("round-trips Application dispatch effects and keeps neutral effects shared", () => {
    const applicationDispatch = {
        ...withoutLegacy(legacyDispatchEffect()),
        applicationTaskRuntimeTargetSha256: TARGET.slice(),
    };
    const dispatch = Result.getOrThrow(
      decodeApplicationTaskRequestedEffectV1(Result.getOrThrow(
        Schema.encodeUnknownResult(
          ApplicationTaskRequestedEffectV1Schema,
          STRICT,
        )(applicationDispatch),
      )),
    );
    const current = toCurrentTaskRequestedEffect({
      generation: "application_v1",
      effect: dispatch,
    });
    expectTypeOf(current).toEqualTypeOf<CurrentTaskRequestedEffect>();
    expect(current.kind).toBe("dispatch_attempt");
    expect(Result.getOrThrow(
      fromCurrentTaskRequestedEffect(current, "application_v1"),
    ))
      .toEqual({ generation: "application_v1", effect: dispatch });

    const neutral = {
      version: "flarex.task-requested-effect.v1" as const,
      runId: RUN_ID,
      acceptedRunVersion: RUN_VERSION_1,
      kind: "notify_current_state" as const,
    };
    expect(toCurrentTaskRequestedEffect({
      generation: "legacy_definition_v1",
      effect: neutral,
    })).toEqual(neutral);
    expect(toCurrentTaskRequestedEffect({
      generation: "application_v1",
      effect: neutral,
    })).toEqual(neutral);
  });

  it("detaches shared-backed definition identities in every persistence adapter", () => {
    const sharedStateTarget = sharedTarget(0x31);
    const sharedGrantTarget = sharedTarget(0x41);
    const sharedEffectTarget = sharedTarget(0x51);
    const currentState = {
      ...withoutLegacy(legacyReadyState()),
      definitionReference: {
        generation: "application_v1" as const,
        applicationTaskRuntimeTargetSha256: sharedStateTarget,
      },
    } satisfies CurrentRunAttemptState;
    const currentGrant = {
      ...withoutLegacy(legacyAttemptGrant()),
      definitionReference: {
        generation: "application_v1" as const,
        applicationTaskRuntimeTargetSha256: sharedGrantTarget,
      },
    } satisfies CurrentTaskAttemptGrant;
    const currentEffect = {
      ...withoutLegacy(legacyDispatchEffect()),
      definitionReference: {
        generation: "application_v1" as const,
        applicationTaskRuntimeTargetSha256: sharedEffectTarget,
      },
    } satisfies CurrentTaskRequestedEffect;
    const persistedState = fromCurrentRunAttemptState(currentState);
    const persistedGrant = fromCurrentTaskAttemptGrant(currentGrant);
    const persistedEffect = Result.getOrThrow(fromCurrentTaskRequestedEffect(
      currentEffect,
      "application_v1",
    ));

    sharedStateTarget.fill(0x91);
    sharedGrantTarget.fill(0x92);
    sharedEffectTarget.fill(0x93);

    expect(persistedState.generation).toBe("application_v1");
    expect(persistedGrant.generation).toBe("application_v1");
    expect(persistedEffect.generation).toBe("application_v1");
    if (persistedState.generation !== "application_v1" ||
      persistedGrant.generation !== "application_v1" ||
      persistedEffect.generation !== "application_v1") {
      throw new Error("Expected Application persistence projections.");
    }
    expect(persistedState.state.applicationTaskRuntimeTargetSha256[0]).toBe(0x31);
    expect(persistedGrant.grant.applicationTaskRuntimeTargetSha256[0]).toBe(0x41);
    if (persistedEffect.effect.kind !== "dispatch_attempt") {
      throw new Error("Expected an Application dispatch effect.");
    }
    expect(persistedEffect.effect.applicationTaskRuntimeTargetSha256[0]).toBe(0x51);
    expect(persistedState.state.applicationTaskRuntimeTargetSha256.buffer)
      .toBeInstanceOf(ArrayBuffer);
    expect(persistedGrant.grant.applicationTaskRuntimeTargetSha256.buffer)
      .toBeInstanceOf(ArrayBuffer);
    expect(persistedEffect.effect.applicationTaskRuntimeTargetSha256.buffer)
      .toBeInstanceOf(ArrayBuffer);
  });

  it("rejects mixed, unknown, and substituted definition identity", () => {
    const applicationState = Result.getOrThrow(Schema.encodeUnknownResult(
      ApplicationRunAttemptStateV1Schema,
      STRICT,
    )({
      ...withoutLegacy(legacyReadyState()),
      applicationTaskRuntimeTargetSha256: TARGET,
    }));
    expect(Result.isFailure(decodeApplicationRunAttemptStateV1({
      ...asRecord(applicationState),
      taskDefinitionRevisionId: DEFINITION_ID,
    }))).toBe(true);
    const encodedGrant = Result.getOrThrow(Schema.encodeUnknownResult(
      ApplicationTaskAttemptGrantV1Schema,
      STRICT,
    )({
      ...withoutLegacy(legacyAttemptGrant()),
      applicationTaskRuntimeTargetSha256: TARGET,
    }));
    expect(Result.isFailure(decodeApplicationTaskAttemptGrantV1({
      ...asRecord(encodedGrant),
      generation: "future_v2",
    }))).toBe(true);
    expect(Result.isFailure(decodeApplicationTaskRequestedEffectV1({
      ...withoutLegacy(legacyDispatchEffect()),
      taskDefinitionRevisionId: TARGET,
    }))).toBe(true);

    const encodedDispatch = Result.getOrThrow(Schema.encodeUnknownResult(
      ApplicationTaskRequestedEffectV1Schema,
      STRICT,
    )({
      ...withoutLegacy(legacyDispatchEffect()),
      applicationTaskRuntimeTargetSha256: TARGET,
    }));
    const shadowedDigest = new Uint8Array(31);
    Object.defineProperty(shadowedDigest, "byteLength", { value: 32 });
    expect(Result.isFailure(decodeApplicationRunAttemptStateV1({
      ...asRecord(applicationState),
      applicationTaskRuntimeTargetSha256: shadowedDigest,
    }))).toBe(true);
    expect(Result.isFailure(decodeApplicationTaskAttemptGrantV1({
      ...asRecord(encodedGrant),
      applicationTaskRuntimeTargetSha256: shadowedDigest,
    }))).toBe(true);
    expect(Result.isFailure(decodeApplicationTaskRequestedEffectV1({
      ...asRecord(encodedDispatch),
      applicationTaskRuntimeTargetSha256: shadowedDigest,
    }))).toBe(true);
    const current = toCurrentTaskRequestedEffect({
      generation: "application_v1",
      effect: Result.getOrThrow(
        decodeApplicationTaskRequestedEffectV1(encodedDispatch),
      ),
    });
    expect(Result.getOrThrow(Result.flip(fromCurrentTaskRequestedEffect(
      current,
      "legacy_definition_v1",
    )))).toMatchObject({
      _tag: "TaskDefinitionReferenceGenerationMismatchError",
      expectedGeneration: "legacy_definition_v1",
      receivedGeneration: "application_v1",
    });
  });
});

function legacyReadyState() {
  return {
    version: "flarex.run-attempt-state.v1" as const,
    runId: RUN_ID,
    taskDefinitionRevisionId: DEFINITION_ID,
    runVersion: RUN_VERSION_1,
    phase: "ready" as const,
    ready: { kind: "initial" as const, eligibleAtMs: NOW },
    cancellation: {
      kind: "not_requested" as const,
      generation: cancellationGeneration(0n),
    },
  };
}

function legacyAttemptGrant() {
  return {
    runId: RUN_ID,
    taskDefinitionRevisionId: DEFINITION_ID,
    acceptedRunVersion: RUN_VERSION_1,
    attempt: {
      attemptId: ATTEMPT_ID,
      attemptNumber: ATTEMPT_NUMBER_1,
      executionFence: FENCE_1,
    },
    computeProfile: COMPUTE_SMALL,
    grantedAtMs: NOW,
    lease: {
      version: LEASE_VERSION_1,
      renewedAtMs: NOW,
      expiresAtMs: databaseTime(NOW + 30_000),
    },
  };
}

function legacyDispatchEffect() {
  return {
    version: "flarex.task-requested-effect.v1" as const,
    runId: RUN_ID,
    acceptedRunVersion: RUN_VERSION_1,
    kind: "dispatch_attempt" as const,
    taskDefinitionRevisionId: DEFINITION_ID,
    attempt: legacyAttemptGrant().attempt,
    leaseVersion: LEASE_VERSION_1,
    computeProfile: COMPUTE_SMALL,
  };
}

function withoutLegacy<Value extends { readonly taskDefinitionRevisionId: unknown }>(
  value: Value,
): Omit<Value, "taskDefinitionRevisionId"> {
  const { taskDefinitionRevisionId: _removed, ...rest } = value;
  return rest;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an encoded lifecycle record.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function sharedTarget(fill: number) {
  return new Uint8Array(new SharedArrayBuffer(32)).fill(fill) as
    ApplicationRunAttemptStateV1["applicationTaskRuntimeTargetSha256"];
}

type EncodedLegacyState = typeof RunAttemptStateV1Schema.Encoded;
type EncodedLegacyGrant = typeof TaskAttemptGrantV1Schema.Encoded;
type EncodedLegacyEffect = typeof TaskRequestedEffectV1Schema.Encoded;
type EncodedLegacyDispatch = Extract<
  EncodedLegacyEffect,
  { readonly kind: "dispatch_attempt" }
>;

expectTypeOf<EncodedLegacyState>().not.toBeUnknown();
expectTypeOf<EncodedLegacyState["runVersion"]>().toEqualTypeOf<string>();
expectTypeOf<EncodedLegacyState["taskDefinitionRevisionId"]>()
  .toEqualTypeOf<string>();
expectTypeOf<EncodedLegacyGrant>().not.toBeUnknown();
expectTypeOf<EncodedLegacyGrant["acceptedRunVersion"]>()
  .toEqualTypeOf<string>();
expectTypeOf<EncodedLegacyGrant["taskDefinitionRevisionId"]>()
  .toEqualTypeOf<string>();
expectTypeOf<EncodedLegacyEffect>().not.toBeUnknown();
expectTypeOf<EncodedLegacyDispatch["leaseVersion"]>().toEqualTypeOf<string>();
expectTypeOf<EncodedLegacyDispatch["taskDefinitionRevisionId"]>()
  .toEqualTypeOf<string>();

expectTypeOf<ApplicationRunAttemptStateV1>()
  .not.toEqualTypeOf<ReturnType<typeof legacyReadyState>>();
expectTypeOf<ApplicationTaskAttemptGrantV1>()
  .not.toEqualTypeOf<ReturnType<typeof legacyAttemptGrant>>();
expectTypeOf<ApplicationTaskRequestedEffectV1>()
  .not.toEqualTypeOf<ReturnType<typeof legacyDispatchEffect>>();
