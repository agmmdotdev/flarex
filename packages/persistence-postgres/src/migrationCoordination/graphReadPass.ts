import { Context, Effect, Encoding, Option } from "effect";
import { isUint8Array } from "@flarex/utils/bytes";
import { additiveMigrationGraphLimits } from "./additiveLimits";

import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { FrameworkMigrationRepositoryError } from "./repositoryErrors";

interface GraphReadPass {
  readonly kind: "frameworkGraphReadPass";
}
interface GraphReadState {
  readonly transaction: FlarexMetadataTransaction;
  readonly releases: Set<() => void>;
  active: boolean;
  retained: number;
}
const states = new WeakMap<GraphReadPass, GraphReadState>();

// This is dynamically repeated read-pass state, not a database service or a
// transaction-wide cache. Only read-only aggregate restorers establish it.
const currentPass = Context.Reference<GraphReadPass | undefined>(
  "flarex/FrameworkMigrationGraphReadPass",
  { defaultValue: () => undefined },
);
const MAX_RETAINED_REFERENCES = 512;

/** Effect.fn transform for a read-only aggregate restoration. Never wrap an
 * ensure, publication, mutable read, or arbitrary transaction callback. */
export const withFrameworkGraphReadPass = Effect.fn(
  "FrameworkMigrationGraphReadPass.withPass",
)(function* <Value, Failure>(
  read: Effect.Effect<Value, Failure>,
  transaction: FlarexMetadataTransaction,
): Effect.fn.Return<Value, Failure> {
  const inherited = yield* currentPass;
  const inheritedState = inherited === undefined ? undefined : states.get(inherited);
  if (inheritedState?.active && inheritedState.transaction === transaction) {
    return yield* read;
  }
  const pass: GraphReadPass = Object.freeze({ kind: "frameworkGraphReadPass" });
  const state: GraphReadState = { transaction, active: true, retained: 0, releases: new Set() };
  states.set(pass, state);
  return yield* read.pipe(
    Effect.provideService(currentPass, pass),
    Effect.ensuring(Effect.sync(() => {
      state.active = false;
      for (const release of state.releases) release();
      state.releases.clear();
      states.delete(pass);
    })),
  );
});

interface ReferenceNode<Value> {
  readonly children: Map<unknown, ReferenceNode<Value>>;
  value: Option.Option<Value>;
}

/** One typed slot per immutable-reference reader. The slot retains no values
 * outside a live pass. Object arguments use identity, including preferred
 * restored authority; primitive references keep their exact runtime types.
 * Only successes are retained, after the original full restoration succeeds. */
type FrameworkGraphReferenceRead<Value> = ((
  read: Effect.Effect<Value, FrameworkMigrationRepositoryError>,
  transaction: FlarexMetadataTransaction,
  ...references: readonly unknown[]
) => Effect.Effect<Value, FrameworkMigrationRepositoryError>) & {
  /** Looks up only a previously successful restoration; never grants authority. */
  readonly peek: (transaction: FlarexMetadataTransaction,
    ...references: readonly unknown[]) => Effect.Effect<Option.Option<Value>>;
};

export function makeFrameworkGraphReferenceRead<Value>(): FrameworkGraphReferenceRead<Value> {
  const roots = new WeakMap<GraphReadPass, ReferenceNode<Value>>();
  // These per-node lookup wrappers are a measured reconstruction hot path.
  // Repository operations retain their named spans and typed error boundaries;
  // avoid allocating another stack capture for every memo lookup and peek.
  const readReference = Effect.fnUntraced(
    function* (
      read: Effect.Effect<Value, FrameworkMigrationRepositoryError>,
      transaction: FlarexMetadataTransaction,
      ...references: readonly unknown[]
    ): Effect.fn.Return<Value, FrameworkMigrationRepositoryError> {
      const pass = yield* currentPass;
      const state = pass === undefined ? undefined : states.get(pass);
      if (pass === undefined || state === undefined || !state.active || state.transaction !== transaction) {
        return yield* read;
      }
      const policyReferences = [yield* additiveMigrationGraphLimits, ...references];
      let found = roots.get(pass);
      for (const reference of policyReferences) found = found?.children.get(reference);
      if (found !== undefined && Option.isSome(found.value)) return found.value.value;

      const value = yield* read;
      if (state.active && state.retained < MAX_RETAINED_REFERENCES) {
        if (!roots.has(pass)) state.releases.add(() => { roots.delete(pass); });
        let node: ReferenceNode<Value> = roots.get(pass) ?? referenceNode();
        roots.set(pass, node);
        for (const reference of policyReferences) {
          let child: ReferenceNode<Value> | undefined = node.children.get(reference);
          if (child === undefined) { child = referenceNode(); node.children.set(reference, child); }
          node = child;
        }
        if (Option.isNone(node.value)) state.retained += 1;
        node.value = Option.some(value);
      }
      return value;
    },
  );
  const peek = Effect.fnUntraced(
    function* (transaction: FlarexMetadataTransaction,
      ...references: readonly unknown[]): Effect.fn.Return<Option.Option<Value>> {
      const pass = yield* currentPass;
      const state = pass === undefined ? undefined : states.get(pass);
      if (pass === undefined || state === undefined || !state.active || state.transaction !== transaction) {
        return Option.none();
      }
      let found = roots.get(pass);
      for (const reference of [yield* additiveMigrationGraphLimits, ...references]) {
        found = found?.children.get(reference);
      }
      return found?.value ?? Option.none();
    },
  );
  return Object.assign(readReference, { peek });
}

function referenceNode<Value>(): ReferenceNode<Value> {
  return { children: new Map(), value: Option.none() };
}

/** Exact projections of already-detached scalar driver rows. Mutable byte/date
 * objects become typed value keys; unexpected objects keep their identity and
 * must still pass the caller's full decoder before any success is retained. */
export function frameworkGraphDriverRowReferences(row: Readonly<Record<string, unknown>>): readonly unknown[] {
  return Object.entries(row).flatMap(([key, value]) =>
    isUint8Array(value) ? [key, "bytes", Encoding.encodeHex(value)] :
      value instanceof Date ? [key, "date", Date.prototype.getTime.call(value)] :
        [key, typeof value, value]);
}
