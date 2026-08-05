import {
  decodePersistedTaskRequestedEffectJsonV1,
  encodePersistedTaskRequestedEffectJsonV1,
  type PersistedTaskRequestedEffectV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Result } from "effect";

import { fxSystemDurableTaskRequestedEffectsV1 } from "./schema";

const UTF8 = new TextEncoder();

export type TaskSystemRequestedEffectRowV1 =
  typeof fxSystemDurableTaskRequestedEffectsV1.$inferSelect;

export function decodeAndCorrelateTaskSystemRequestedEffectRowV1(
  row: TaskSystemRequestedEffectRowV1,
): Result.Result<PersistedTaskRequestedEffectV1, "effect_sequence_invalid"> {
  if (row.payloadCodecVersion !== 1) {
    return Result.fail("effect_sequence_invalid");
  }
  return Result.gen(function* () {
    const effect = yield* decodePersistedTaskRequestedEffectJsonV1(
      row.payloadJson,
    ).pipe(Result.mapError(() => "effect_sequence_invalid" as const));
    const canonical = yield* encodePersistedTaskRequestedEffectJsonV1(
      effect,
    ).pipe(Result.mapError(() => "effect_sequence_invalid" as const));
    if (
      row.sequence !== effect.sequence
      || row.runId !== effect.effect.runId
      || row.acceptedRunVersion !== effect.effect.acceptedRunVersion
      || row.kind !== effect.effect.kind
      || row.notBeforeMs !== taskSystemRequestedEffectNotBeforeMsV1(effect)
      || row.payloadByteLength !== encodedJsonByteLength(canonical)
    ) {
      return yield* Result.fail("effect_sequence_invalid" as const);
    }
    return effect;
  });
}

export function taskSystemRequestedEffectNotBeforeMsV1(
  effect: PersistedTaskRequestedEffectV1,
): bigint | null {
  switch (effect.effect.kind) {
    case "continue_retry":
    case "wake_retry":
    case "wake_lease_expiry":
      return BigInt(effect.effect.notBeforeMs);
    case "dispatch_attempt":
    case "request_execution_cancellation":
    case "release_queue_ownership":
    case "publish_lifecycle_event":
    case "notify_current_state":
    case "cancel_obsolete_lease_wake":
      return null;
    default:
      return assertUnreachableRequestedEffect(effect.effect);
  }
}

function assertUnreachableRequestedEffect(value: never): never {
  throw new TypeError(`Unhandled requested effect: ${String(value)}`);
}

function encodedJsonByteLength(value: unknown): bigint {
  return BigInt(UTF8.encode(JSON.stringify(value)).byteLength);
}
