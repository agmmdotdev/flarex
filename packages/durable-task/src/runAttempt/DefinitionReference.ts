import { bytesEqual, copyBytes, isUint8Array } from "@flarex/utils/bytes";
import { Result } from "effect";

import type {
  ApplicationTaskRuntimeTargetSha256V1,
  TaskDefinitionReference,
} from "../runCreation/Model.js";
import type {
  ApplicationRunAttemptStateV1,
  ApplicationTaskRunAttemptAggregateV1,
  ApplicationTaskAttemptGrantV1,
  ApplicationTaskRequestedEffectV1,
  CurrentRunAttemptState,
  CurrentTaskAttemptGrant,
  CurrentTaskRunAttemptAggregate,
  CurrentTaskRequestedEffect,
  RunAttemptStateV1,
  TaskRunAttemptAggregateV1,
  TaskAttemptGrantV1,
  TaskRequestedEffectV1,
} from "./Model.js";
import {
  TaskDefinitionReferenceGenerationMismatchError,
  TaskDefinitionReferenceIdentityMismatchError,
} from "./Errors.js";

export type PersistedRunAttemptState =
  | Readonly<{ readonly generation: "legacy_definition_v1"; readonly state: RunAttemptStateV1 }>
  | Readonly<{ readonly generation: "application_v1"; readonly state: ApplicationRunAttemptStateV1 }>;

export type PersistedTaskAttemptGrant =
  | Readonly<{ readonly generation: "legacy_definition_v1"; readonly grant: TaskAttemptGrantV1 }>
  | Readonly<{ readonly generation: "application_v1"; readonly grant: ApplicationTaskAttemptGrantV1 }>;

export type PersistedTaskRequestedEffect =
  | Readonly<{ readonly generation: "legacy_definition_v1"; readonly effect: TaskRequestedEffectV1 }>
  | Readonly<{ readonly generation: "application_v1"; readonly effect: ApplicationTaskRequestedEffectV1 }>;

export type PersistedTaskRunAttemptAggregate =
  | Readonly<{
      readonly generation: "legacy_definition_v1";
      readonly aggregate: TaskRunAttemptAggregateV1;
    }>
  | Readonly<{
      readonly generation: "application_v1";
      readonly aggregate: ApplicationTaskRunAttemptAggregateV1;
    }>;

export function toCurrentTaskRunAttemptAggregate(
  input: PersistedTaskRunAttemptAggregate,
): CurrentTaskRunAttemptAggregate {
  return snapshot(Result.getOrThrow(transformDefinitionIdentity(
    input.aggregate,
    input.generation,
    "to_current",
  ))) as CurrentTaskRunAttemptAggregate;
}

export function fromCurrentTaskRunAttemptAggregate(
  aggregate: CurrentTaskRunAttemptAggregate,
  generation: PersistedTaskRunAttemptAggregate["generation"],
): Result.Result<
  PersistedTaskRunAttemptAggregate,
  | TaskDefinitionReferenceGenerationMismatchError
  | TaskDefinitionReferenceIdentityMismatchError
> {
  return Result.gen(function* () {
    const owned = snapshot(aggregate);
    yield* validateCurrentDefinitionReferences(owned, generation);
    const transformed = yield* transformDefinitionIdentity(
      owned,
      generation,
      "from_current",
    );
    return Object.freeze(generation === "legacy_definition_v1"
      ? {
          generation,
          aggregate: snapshot(transformed) as TaskRunAttemptAggregateV1,
        }
      : {
          generation,
          aggregate: snapshot(transformed) as
            ApplicationTaskRunAttemptAggregateV1,
        });
  });
}

function validateCurrentDefinitionReferences(
  value: unknown,
  generation: PersistedTaskRunAttemptAggregate["generation"],
): Result.Result<
  void,
  | TaskDefinitionReferenceGenerationMismatchError
  | TaskDefinitionReferenceIdentityMismatchError
> {
  let expected: TaskDefinitionReference | undefined;

  function visit(input: unknown): Result.Result<
    void,
    | TaskDefinitionReferenceGenerationMismatchError
    | TaskDefinitionReferenceIdentityMismatchError
  > {
    if (isUint8Array(input) || input === null || typeof input !== "object") {
      return Result.succeed(undefined);
    }
    if (Array.isArray(input)) {
      return Result.gen(function* () {
        for (const child of input) yield* visit(child);
      });
    }
    const record = input as Readonly<Record<string, unknown>>;
    if ("definitionReference" in record) {
      const reference = record.definitionReference as TaskDefinitionReference;
      if (reference.generation !== generation) {
        return Result.fail(new TaskDefinitionReferenceGenerationMismatchError({
          operation: "persist_aggregate",
          expectedGeneration: generation,
          receivedGeneration: reference.generation,
        }));
      }
      if (expected === undefined) {
        expected = reference;
      } else if (!definitionReferencesEqual(expected, reference)) {
        return Result.fail(new TaskDefinitionReferenceIdentityMismatchError({
          operation: "persist_aggregate",
          generation,
        }));
      }
    }
    return Result.gen(function* () {
      for (const child of Object.values(record)) yield* visit(child);
    });
  }

  return visit(value);
}

function definitionReferencesEqual(
  left: TaskDefinitionReference,
  right: TaskDefinitionReference,
): boolean {
  if (left.generation === "legacy_definition_v1") {
    return right.generation === "legacy_definition_v1" &&
      left.taskDefinitionRevisionId === right.taskDefinitionRevisionId;
  }
  return right.generation === "application_v1" && bytesEqual(
    left.applicationTaskRuntimeTargetSha256,
    right.applicationTaskRuntimeTargetSha256,
  );
}

export function toCurrentRunAttemptState(
  input: PersistedRunAttemptState,
): CurrentRunAttemptState {
  if (input.generation === "legacy_definition_v1") {
    const state = input.state;
    const { taskDefinitionRevisionId, ...rest } = state;
    return snapshot({
      ...rest,
      definitionReference: Object.freeze({
        generation: "legacy_definition_v1" as const,
        taskDefinitionRevisionId,
      }),
    }) as CurrentRunAttemptState;
  }
  const state = input.state;
  const { applicationTaskRuntimeTargetSha256, ...rest } = state;
  return snapshot({
    ...rest,
    definitionReference: applicationReference(
      applicationTaskRuntimeTargetSha256,
    ),
  }) as CurrentRunAttemptState;
}

export function fromCurrentRunAttemptState(
  state: CurrentRunAttemptState,
): PersistedRunAttemptState {
  const { definitionReference, ...rest } = state;
  return definitionReference.generation === "legacy_definition_v1"
    ? Object.freeze({
        generation: "legacy_definition_v1" as const,
        state: snapshot({
          ...rest,
          taskDefinitionRevisionId:
            definitionReference.taskDefinitionRevisionId,
        }) as RunAttemptStateV1,
      })
    : Object.freeze({
        generation: "application_v1" as const,
        state: snapshot({
          ...rest,
          applicationTaskRuntimeTargetSha256:
            definitionReference.applicationTaskRuntimeTargetSha256,
        }) as ApplicationRunAttemptStateV1,
      });
}

export function toCurrentTaskAttemptGrant(
  input: PersistedTaskAttemptGrant,
): CurrentTaskAttemptGrant {
  if (input.generation === "legacy_definition_v1") {
    const grant = input.grant;
    const { taskDefinitionRevisionId, ...rest } = grant;
    return snapshot({
      ...rest,
      definitionReference: Object.freeze({
        generation: "legacy_definition_v1" as const,
        taskDefinitionRevisionId,
      }),
    }) as CurrentTaskAttemptGrant;
  }
  const grant = input.grant;
  const { applicationTaskRuntimeTargetSha256, ...rest } = grant;
  return snapshot({
    ...rest,
    definitionReference: applicationReference(
      applicationTaskRuntimeTargetSha256,
    ),
  }) as CurrentTaskAttemptGrant;
}

export function fromCurrentTaskAttemptGrant(
  grant: CurrentTaskAttemptGrant,
): PersistedTaskAttemptGrant {
  const { definitionReference, ...rest } = grant;
  return definitionReference.generation === "legacy_definition_v1"
    ? Object.freeze({
        generation: "legacy_definition_v1" as const,
        grant: snapshot({
          ...rest,
          taskDefinitionRevisionId:
            definitionReference.taskDefinitionRevisionId,
        }) as TaskAttemptGrantV1,
      })
    : Object.freeze({
        generation: "application_v1" as const,
        grant: snapshot({
          ...rest,
          applicationTaskRuntimeTargetSha256:
            definitionReference.applicationTaskRuntimeTargetSha256,
        }) as ApplicationTaskAttemptGrantV1,
      });
}

export function toCurrentTaskRequestedEffect(
  input: PersistedTaskRequestedEffect,
): CurrentTaskRequestedEffect {
  if (input.generation === "legacy_definition_v1") {
    const effect = input.effect;
    if (effect.kind !== "dispatch_attempt") return snapshot(effect);
    const { taskDefinitionRevisionId, ...rest } = effect;
    return snapshot({
      ...rest,
      definitionReference: Object.freeze({
        generation: "legacy_definition_v1" as const,
        taskDefinitionRevisionId,
      }),
    }) as CurrentTaskRequestedEffect;
  }
  const effect = input.effect;
  if (effect.kind !== "dispatch_attempt") return snapshot(effect);
  const { applicationTaskRuntimeTargetSha256, ...rest } = effect;
  return snapshot({
    ...rest,
    definitionReference: applicationReference(
      applicationTaskRuntimeTargetSha256,
    ),
  }) as CurrentTaskRequestedEffect;
}

export function fromCurrentTaskRequestedEffect(
  effect: CurrentTaskRequestedEffect,
  generation: PersistedTaskRequestedEffect["generation"],
): Result.Result<
  PersistedTaskRequestedEffect,
  TaskDefinitionReferenceGenerationMismatchError
> {
  if (effect.kind !== "dispatch_attempt") {
    return Result.succeed(Object.freeze({ generation, effect: snapshot(effect) }));
  }
  const { definitionReference, ...rest } = effect;
  if (definitionReference.generation !== generation) {
    return Result.fail(new TaskDefinitionReferenceGenerationMismatchError({
      operation: "persist_requested_effect",
      expectedGeneration: generation,
      receivedGeneration: definitionReference.generation,
    }));
  }
  if (definitionReference.generation === "legacy_definition_v1") {
    return Result.succeed(Object.freeze({
      generation: "legacy_definition_v1" as const,
      effect: snapshot({
        ...rest,
        taskDefinitionRevisionId: definitionReference.taskDefinitionRevisionId,
      }) as TaskRequestedEffectV1,
    }));
  }
  return Result.succeed(Object.freeze({
    generation: "application_v1" as const,
    effect: snapshot({
      ...rest,
      applicationTaskRuntimeTargetSha256:
        definitionReference.applicationTaskRuntimeTargetSha256,
    }) as ApplicationTaskRequestedEffectV1,
  }));
}

function applicationReference(
  digest: ApplicationTaskRuntimeTargetSha256V1,
): TaskDefinitionReference {
  return Object.freeze({
    generation: "application_v1" as const,
    applicationTaskRuntimeTargetSha256: copyBytes(digest) as
      ApplicationTaskRuntimeTargetSha256V1,
  });
}

function transformDefinitionIdentity(
  value: unknown,
  generation: PersistedTaskRunAttemptAggregate["generation"],
  direction: "to_current" | "from_current",
): Result.Result<
  unknown,
  TaskDefinitionReferenceGenerationMismatchError
> {
  if (isUint8Array(value)) return Result.succeed(copyBytes(value));
  if (Array.isArray(value)) {
    return Result.gen(function* () {
      const transformed: unknown[] = [];
      for (const child of value) {
        transformed.push(yield* transformDefinitionIdentity(
          child,
          generation,
          direction,
        ));
      }
      return transformed;
    });
  }
  if (value === null || typeof value !== "object") {
    return Result.succeed(value);
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (direction === "to_current") {
    if (generation === "legacy_definition_v1" &&
      typeof record.taskDefinitionRevisionId === "string") {
      const { taskDefinitionRevisionId, ...rest } = record;
      return transformRecord(rest, generation, direction, {
        definitionReference: Object.freeze({
          generation,
          taskDefinitionRevisionId,
        }),
      });
    }
    if (generation === "application_v1" &&
      isUint8Array(record.applicationTaskRuntimeTargetSha256)) {
      const { applicationTaskRuntimeTargetSha256, ...rest } = record;
      return transformRecord(rest, generation, direction, {
        definitionReference: applicationReference(
          applicationTaskRuntimeTargetSha256 as
            ApplicationTaskRuntimeTargetSha256V1,
        ),
      });
    }
  } else if ("definitionReference" in record) {
    const reference = record.definitionReference as TaskDefinitionReference;
    if (reference.generation !== generation) {
      return Result.fail(new TaskDefinitionReferenceGenerationMismatchError({
        operation: "persist_aggregate",
        expectedGeneration: generation,
        receivedGeneration: reference.generation,
      }));
    }
    const { definitionReference: _removed, ...rest } = record;
    return reference.generation === "legacy_definition_v1"
      ? transformRecord(rest, generation, direction, {
          taskDefinitionRevisionId: reference.taskDefinitionRevisionId,
        })
      : transformRecord(rest, generation, direction, {
          applicationTaskRuntimeTargetSha256: copyBytes(
            reference.applicationTaskRuntimeTargetSha256,
          ),
        });
  }
  return transformRecord(record, generation, direction);
}

function transformRecord(
  record: Readonly<Record<string, unknown>>,
  generation: PersistedTaskRunAttemptAggregate["generation"],
  direction: "to_current" | "from_current",
  extra: Readonly<Record<string, unknown>> = {},
): Result.Result<
  unknown,
  TaskDefinitionReferenceGenerationMismatchError
> {
  return Result.gen(function* () {
    const transformed: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      transformed[key] = yield* transformDefinitionIdentity(
        child,
        generation,
        direction,
      );
    }
    return { ...transformed, ...extra };
  });
}

function snapshot<Value>(value: Value): Value {
  const owned = snapshotValue(value, new WeakMap<object, unknown>());
  freeze(owned);
  return owned;
}

function snapshotValue<Value>(
  value: Value,
  seen: WeakMap<object, unknown>,
): Value {
  if (isUint8Array(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) return existing as Value;
    const owned = copyBytes(value);
    seen.set(value, owned);
    return owned as Value;
  }
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) return existing as Value;
    const owned: unknown[] = [];
    seen.set(value, owned);
    for (const child of value) owned.push(snapshotValue(child, seen));
    return owned as Value;
  }
  if (value !== null && typeof value === "object") {
    const existing = seen.get(value);
    if (existing !== undefined) return existing as Value;
    const owned: Record<string, unknown> = {};
    seen.set(value, owned);
    for (const [key, child] of Object.entries(value)) {
      owned[key] = snapshotValue(child, seen);
    }
    return owned as Value;
  }
  return value;
}

function freeze(value: unknown): void {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) {
    return;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    freeze(child);
  }
  Object.freeze(value);
}
