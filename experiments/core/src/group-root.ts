import { Cause, Effect, Exit, Fiber, Ref, Scope, Semaphore } from "effect";
import type { Definition } from "./definition.ts";
import { CoreError, type ApplicationFailure, type DocumentValidationFailure, type NativeFailure } from "./errors.ts";
import { createBudget } from "./budget.ts";
import { createRoot, type Root } from "./root.ts";
import { createApplicationMutationRoot, type ApplicationMutationRoot } from "./application-root.ts";
import { createApplicationStorage } from "./application-storage.ts";
import { createStorage } from "./storage.ts";
import { joinOwned } from "./callback.ts";
import type { GroupCandidate } from "./group-storage.ts";
import type { Command, Persistence, Snapshot } from "./persistence.ts";

type GroupError = CoreError | ApplicationFailure | DocumentValidationFailure | NativeFailure;
interface Borrow { live: boolean }
export type BorrowedFrameworkRoot = Pick<Root, "get" | "insert" | "replace" | "delete" | "event" | "poison" | "poisonCause">;
export type BorrowedApplicationRoot = Pick<ApplicationMutationRoot, "get" | "range" | "insert" | "patch" | "replace" | "delete" | "poison">;
type Participant = { readonly definition: Definition; readonly kind: "framework"; readonly root: Root }
  | { readonly definition: Definition; readonly kind: "application"; readonly root: ApplicationMutationRoot };

/** Trusted composition owns this root. Every callback and borrowed operation is
 * automatically supervised; no caller can forget a guard or settle a child. */
export const createGroupRoot = Effect.fn("ExperimentGroupRoot.create")(function* (persistence: Persistence, command: Command, definitions: readonly Definition[]) {
  if (command.profile === "application" || command.status !== "active") return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
  const state = yield* Ref.make<{ live: boolean; failure: Cause.Cause<GroupError> | null }>({ live: true, failure: null });
  const operations = yield* Scope.make(); const lifecycle = yield* Semaphore.make(1);
  const running = new Set<Fiber.Fiber<unknown, GroupError>>();
  const budget = createBudget(); const serialized = yield* Semaphore.make(1);
  const participants = new Map<string, Participant>(); const snapshots: Snapshot[] = [];
  if (command.profile === "mixed") snapshots.push(yield* persistence.commandSnapshot(command));
  const applicationStorage = createApplicationStorage(persistence); const storage = createStorage(persistence);
  const poison = (cause: Cause.Cause<GroupError>) => Ref.update(state, prior => ({ ...prior, failure: prior.failure ?? cause }));
  const frameworkObservations = { observeUnique: storage.observeUnique, observeRows: command.profile === "framework" ? storage.observeRows
    : Effect.fn("ExperimentGroupRoot.snapshotRows")(function* (child: Command, ids: readonly string[], remainingBytes: number) {
      const snapshot = yield* persistence.commandSnapshot(child); const rows = []; let remaining = remainingBytes;
      for (const id of ids) { const row = yield* applicationStorage.point(snapshot, id, remaining); rows.push(row); remaining -= row.bytes; }
      return rows;
    }) };
  yield* Effect.gen(function* () {
  for (const definition of definitions) {
    if (participants.has(definition.table)) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    const child = yield* persistence.participant(command, definition);
    if (definition.tableId === null) {
      if (command.profile === "mixed") snapshots.push(yield* persistence.commandSnapshot(child));
      participants.set(definition.table, { definition, kind: "framework", root: yield* createRoot(definition, frameworkObservations, child, budget, serialized) });
    } else {
      if (command.profile !== "mixed") return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
      const snapshot = yield* persistence.commandSnapshot(child); snapshots.push(snapshot);
      participants.set(definition.table, { definition, kind: "application", root: yield* createApplicationMutationRoot(definition, applicationStorage, snapshot, budget, serialized) });
    }
  }
  }).pipe(Effect.onExit(exit => Exit.isFailure(exit) ? Effect.gen(function* () {
    for (const participant of participants.values()) yield* participant.root.close;
    for (const snapshot of snapshots) yield* persistence.closeSnapshot(snapshot);
    yield* Scope.close(operations, Exit.void);
  }) : Effect.void));
  const own = Effect.fn("ExperimentGroupRoot.own")(<A, E extends GroupError>(work: Effect.Effect<A, E>, borrow?: Borrow) => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const child = yield* lifecycle.withPermit(Effect.gen(function* () {
      const prior = yield* Ref.get(state);
      if (borrow?.live === false) return yield* Effect.fail(new CoreError({ reason: "closed" }));
      // The parent retains the original full Cause for freeze/outer outcome.
      // A later borrowed operation receives its own closed-lifetime refusal.
      if (prior.failure !== null) return yield* Effect.fail(new CoreError({ reason: "closed", cause: prior.failure }));
      if (!prior.live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
      const issued = yield* Effect.forkIn(operations)(work.pipe(Effect.tapCause(poison)));
      running.add(issued); return issued;
    }));
    return yield* restore(joinOwned(child)).pipe(Effect.ensuring(Effect.sync(() => { running.delete(child); })));
  })));
  const withFramework = Effect.fn("ExperimentGroupRoot.withFramework")(<A, E extends GroupError>(definition: Definition, use: (root: BorrowedFrameworkRoot) => Effect.Effect<A, E>) => own(Effect.gen(function* () {
    const participant = participants.get(definition.table);
    if (participant?.kind !== "framework" || participant.definition !== definition) return yield* Effect.fail(new CoreError({ reason: "denied" }));
    const root = participant.root; const borrow: Borrow = { live: true };
    // Latching cannot fail and replace the originating native Cause. Its
    // authority check and parent update are one atomic Ref operation; revoked
    // latches have no effect on this or a later callback's failure state.
    const latch = (cause: Cause.Cause<CoreError>) => Ref.update(state, prior => borrow.live && prior.live
      ? { ...prior, failure: prior.failure ?? cause } : prior);
    const operation = Effect.fn("ExperimentGroupRoot.frameworkOperation")(function* <B>(work: Effect.Effect<B, CoreError>) {
      return yield* own(work, borrow);
    });
    return yield* Effect.suspend(() => use({ get: id => operation(root.get(id)), insert: value => operation(root.insert(value)),
      replace: value => operation(root.replace(value)), delete: id => operation(root.delete(id)), event: value => operation(root.event(value)),
      poison: error => latch(Cause.fail(error)), poisonCause: latch,
    })).pipe(Effect.ensuring(Effect.sync(() => { borrow.live = false; })));
  })));
  const withApplication = Effect.fn("ExperimentGroupRoot.withApplication")(<A, E extends GroupError>(definition: Definition, use: (root: BorrowedApplicationRoot) => Effect.Effect<A, E>) => own(Effect.gen(function* () {
    const participant = participants.get(definition.table);
    if (participant?.kind !== "application" || participant.definition !== definition) return yield* Effect.fail(new CoreError({ reason: "denied" }));
    const root = participant.root; const borrow: Borrow = { live: true };
    const latch = (cause: Cause.Cause<CoreError | DocumentValidationFailure>) => Ref.update(state, prior => borrow.live && prior.live
      ? { ...prior, failure: prior.failure ?? cause } : prior);
    const operation = Effect.fn("ExperimentGroupRoot.applicationOperation")(function* <B, F extends GroupError>(work: Effect.Effect<B, F>) {
      return yield* own(work, borrow);
    });
    return yield* Effect.suspend(() => use({ get: id => operation(root.get(id)), range: range => operation(root.range(range)),
      insert: value => operation(root.insert(value)), patch: (id, value) => operation(root.patch(id, value)),
      replace: (id, value) => operation(root.replace(id, value)), delete: id => operation(root.delete(id)),
      poison: latch,
    })).pipe(Effect.ensuring(Effect.sync(() => { borrow.live = false; })));
  })));
  const freeze = Effect.fn("ExperimentGroupRoot.freeze")(function* () {
    yield* lifecycle.withPermit(Effect.gen(function* () {
      const prior = yield* Ref.get(state);
      if (prior.failure !== null) return yield* Effect.failCause(prior.failure);
      if (!prior.live || running.size !== 0) return yield* Effect.fail(new CoreError({ reason: "closed" }));
      yield* Ref.set(state, { ...prior, live: false });
    }));
    const candidates: GroupCandidate[] = [];
    for (const participant of participants.values()) {
      if (participant.kind === "framework") {
        const frozen = yield* participant.root.freeze();
        candidates.push({ definition: participant.definition, changes: frozen.changes, events: frozen.events, uniques: frozen.dependencies, dependencies: frozen.points });
      } else {
        const frozen = yield* participant.root.freeze();
        candidates.push({ definition: participant.definition, ...frozen, uniques: [], events: [] });
      }
    }
    return candidates;
  });
  const close = Effect.uninterruptible(Effect.gen(function* () {
    const active = yield* lifecycle.withPermit(Ref.update(state, value => ({ ...value, live: false })).pipe(Effect.map(() => [...running])));
    for (const participant of participants.values()) yield* participant.root.close;
    const scopeExit = yield* Effect.exit(Scope.close(operations, Exit.void));
    const outcomes = yield* Effect.forEach(active, fiber => Fiber.await(fiber));
    for (const snapshot of snapshots) yield* persistence.closeSnapshot(snapshot);
    running.clear();
    const reasons = [...(Exit.isFailure(scopeExit) ? scopeExit.cause.reasons : []),
      ...outcomes.flatMap(exit => Exit.isFailure(exit) ? exit.cause.reasons : [])].filter(reason => !Cause.isInterruptReason(reason));
    if (reasons.length !== 0) return yield* Effect.failCause(Cause.fromReasons(reasons));
  }));
  return { withFramework, withApplication, freeze, close, diagnostics: budget.diagnostics };
});
export type GroupRoot = Effect.Success<ReturnType<typeof createGroupRoot>>;
