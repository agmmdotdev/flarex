import { copyBytes, isUint8Array } from "@flarex/utils/bytes";
import { Result } from "effect";

import type {
  ApplicationTaskRuntimeTargetSha256V1,
  TaskDefinitionReference,
} from "../runCreation/Model.js";
import type {
  ApplicationRunAttemptStateV1,
  ApplicationTaskAttemptGrantV1,
  ApplicationTaskRequestedEffectV1,
  CurrentRunAttemptState,
  CurrentTaskAttemptGrant,
  CurrentTaskRequestedEffect,
  RunAttemptStateV1,
  TaskAttemptGrantV1,
  TaskRequestedEffectV1,
} from "./Model.js";
import { TaskDefinitionReferenceGenerationMismatchError } from "./Errors.js";

export type PersistedRunAttemptState =
  | Readonly<{ readonly generation: "legacy_definition_v1"; readonly state: RunAttemptStateV1 }>
  | Readonly<{ readonly generation: "application_v1"; readonly state: ApplicationRunAttemptStateV1 }>;

export type PersistedTaskAttemptGrant =
  | Readonly<{ readonly generation: "legacy_definition_v1"; readonly grant: TaskAttemptGrantV1 }>
  | Readonly<{ readonly generation: "application_v1"; readonly grant: ApplicationTaskAttemptGrantV1 }>;

export type PersistedTaskRequestedEffect =
  | Readonly<{ readonly generation: "legacy_definition_v1"; readonly effect: TaskRequestedEffectV1 }>
  | Readonly<{ readonly generation: "application_v1"; readonly effect: ApplicationTaskRequestedEffectV1 }>;

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

function snapshot<Value>(value: Value): Value {
  const owned = snapshotValue(value);
  freeze(owned);
  return owned;
}

function snapshotValue<Value>(value: Value): Value {
  if (isUint8Array(value)) {
    return copyBytes(value) as Value;
  }
  if (Array.isArray(value)) {
    return value.map(snapshotValue) as Value;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, snapshotValue(child)]),
    ) as Value;
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
