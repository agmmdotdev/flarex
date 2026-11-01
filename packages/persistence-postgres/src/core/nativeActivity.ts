import { Effect, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { CoreTransactionError, type CoreError, type CoreNativeActivity, type CoreNativeActivityCursor,
  type CoreNativeLifecycleActivity, type CoreNativeMutationActivity, type CoreNativeSetNullIntent,
  type CoreNativeReferenceReplacement } from "./api";
import { useCapturedPrivateJsonData } from "../values/privateJsonData";
import type { CoreTransactionNativeAccess } from "./transaction";

type Mutation = Omit<CoreNativeMutationActivity, "ordinal">;
type NativeSource = Extract<CoreTransactionNativeAccess, { readonly kind: "native" }>;
interface SourceActivity {
  readonly mutations: CoreNativeMutationActivity[];
  readonly lifecycle: CoreNativeLifecycleActivity[];
  readonly uses: Map<string, Readonly<{ table: string; id: string; ordinal: number }>>;
  observations: number;
  readonly setNull: CoreNativeSetNullIntent[];
  readonly referenceReplacements: CoreNativeReferenceReplacement[];
}

/** Opt-in semantic evidence from the actual mutation owner. No lookup,
 * replay, second pending state or catalog/SQL transcript is reconstructed. */
export class CoreNativeActivityOwner {
  readonly #sources = new Map<NativeSource, SourceActivity>();
  readonly #cursors = new WeakMap<CoreNativeActivityCursor, Readonly<{ source: NativeSource; mutations: number; lifecycle: number;
    observations: number; setNull: number; referenceReplacements: number }>>();
  constructor(readonly chargeRetained: (bytes: number) => Effect.Effect<void, CoreError>) {}

  active(source: NativeSource): boolean { return this.#sources.has(source); }

  checkpoint(): () => void {
    const positions = new Map([...this.#sources].map(([source, activity]) => [source,
      { mutations: activity.mutations.length, lifecycle: activity.lifecycle.length,
        setNull: activity.setNull.length, referenceReplacements: activity.referenceReplacements.length }]));
    return () => {
      for (const [source, activity] of this.#sources) {
        activity.mutations.length = positions.get(source)?.mutations ?? 0;
        activity.lifecycle.length = positions.get(source)?.lifecycle ?? 0;
        activity.setNull.length = positions.get(source)?.setNull ?? 0;
        activity.referenceReplacements.length = positions.get(source)?.referenceReplacements ?? 0;
      }
    };
  }

  cursor(source: NativeSource): CoreNativeActivityCursor {
    let activity = this.#sources.get(source);
    if (activity === undefined) {
      activity = { mutations: [], lifecycle: [], uses: new Map(), observations: 0, setNull: [], referenceReplacements: [] };
      this.#sources.set(source, activity);
    }
    // SAFETY: only this owner issues and authenticates the opaque live-root position.
    const cursor = Object.freeze({}) as CoreNativeActivityCursor;
    this.#cursors.set(cursor, { source, mutations: activity.mutations.length, lifecycle: activity.lifecycle.length,
      observations: activity.observations, setNull: activity.setNull.length, referenceReplacements: activity.referenceReplacements.length });
    return cursor;
  }

  mark(source: NativeSource, table: string, id: string): void {
    const activity = this.#sources.get(source);
    if (activity === undefined) return;
    activity.uses.set(`${table}\0${id}`, { table, id, ordinal: ++activity.observations });
  }

  setNull(source: NativeSource, intent: CoreNativeSetNullIntent): void { this.#sources.get(source)?.setNull.push(intent); }
  referenceReplacement(source: NativeSource, intent: CoreNativeReferenceReplacement): void { this.#sources.get(source)?.referenceReplacements.push(intent); }

  usesSince(source: NativeSource, cursor: CoreNativeActivityCursor) {
    const position = this.#cursors.get(cursor), activity = this.#sources.get(source);
    return position?.source !== source || activity === undefined
      ? Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }))
      : Result.succeed([...activity.uses.values()].filter(use => use.ordinal > position.observations));
  }

  since(source: NativeSource, cursor: CoreNativeActivityCursor): Result.Result<Omit<CoreNativeActivity, "observedRows">, CoreError> {
    const position = this.#cursors.get(cursor), activity = this.#sources.get(source);
    if (position?.source !== source || activity === undefined || position.mutations > activity.mutations.length
      || position.lifecycle > activity.lifecycle.length || position.setNull > activity.setNull.length
      || position.referenceReplacements > activity.referenceReplacements.length)
      return Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    const mutations = activity.mutations.slice(position.mutations).map((entry, ordinal) => Object.freeze({ ...entry, ordinal }));
    const lifecycle: CoreNativeLifecycleActivity[] = [];
    for (const entry of activity.lifecycle.slice(position.lifecycle)) {
      if (entry.attemptOrdinal !== null && entry.attemptOrdinal < position.mutations)
        return Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
      lifecycle.push(Object.freeze({ ...entry, attemptOrdinal: entry.attemptOrdinal === null ? null : entry.attemptOrdinal - position.mutations }));
    }
    return Result.succeed(Object.freeze({ mutations: Object.freeze(mutations), lifecycle: Object.freeze(lifecycle),
      setNull: Object.freeze(activity.setNull.slice(position.setNull)),
      referenceReplacements: Object.freeze(activity.referenceReplacements.slice(position.referenceReplacements)) }));
  }

  prepareMutation = Effect.fn("CoreNativeActivity.prepareMutation")((source: NativeSource, entry: Mutation) => Effect.suspend(() => {
    const activity = this.#sources.get(source), charge = this.chargeRetained;
    if (activity === undefined) return Effect.succeed(() => {});
    const table = entry.table, operation = entry.operation;
    return Effect.gen(function* () {
    const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(entry, Number.MAX_SAFE_INTEGER,
      (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause })));
    yield* charge(captured.bytes + 128);
    // The source owns typed fields; the capture owns the immutable native JSON trees.
    const before = isJsonObject(captured.value) ? captured.value.before : undefined;
    const after = isJsonObject(captured.value) ? captured.value.after : undefined;
    const realNormalization = isJsonObject(captured.value)
      ? captured.value.realNormalization : undefined;
    if (before === undefined || after === undefined || before !== null && !isJsonObject(before) || after !== null && !isJsonObject(after)
      || realNormalization !== undefined && !isJsonObject(realNormalization))
      return yield* new CoreTransactionError({ reason: "invalidValue" });
    // Reserve retained evidence before the actual write. Publishing this
    // already captured record after a successful stage cannot fail a budget.
    return () => { activity.mutations.push(Object.freeze({ table, operation, ordinal: activity.mutations.length,
      before, after, ...(realNormalization === undefined ? {} : { realNormalization }) })); };
    });
  }));

  lifecycle = Effect.fn("CoreNativeActivity.lifecycle")((source: NativeSource, entry: Omit<CoreNativeLifecycleActivity, "attemptOrdinal">,
    changed: boolean) => Effect.suspend(() => {
    const activity = this.#sources.get(source), charge = this.chargeRetained;
    if (activity === undefined) return Effect.void;
    const table = entry.table, operation = entry.operation, key = Object.freeze({ ...entry.key }),
      beforeDeletedAt = entry.beforeDeletedAt, afterDeletedAt = entry.afterDeletedAt;
    return Effect.gen(function* () {
    const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(entry, Number.MAX_SAFE_INTEGER,
      (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause })));
    yield* charge(captured.bytes + 128);
    const row = isJsonObject(captured.value) ? captured.value.rowAtOperation : undefined;
    if (row === undefined || row !== null && !isJsonObject(row)) return yield* new CoreTransactionError({ reason: "invalidValue" });
    activity.lifecycle.push(Object.freeze({ table, operation, key, beforeDeletedAt, afterDeletedAt, rowAtOperation: row,
      attemptOrdinal: changed ? activity.mutations.length - 1 : null }));
    });
  }));
}
