import { Cause, Clock, Deferred, Duration, Effect, Exit, Result } from "effect";
import { CoreTransactionError, type CoreError } from "./api";
import { coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import type { CoreFinalizedState } from "./transaction";

export interface CoreSettlementPermit { readonly release: Effect.Effect<void> }
interface SettlementTicket extends CoreSettlementPermit { readonly ready: Effect.Effect<void, CoreError> }
interface Waiter {
  readonly mode: "shared" | "exclusive";
  readonly ready: Deferred.Deferred<void, CoreError>;
  state: "created" | "waiting" | "granted" | "released";
}

/** Namespace locks have one writer; the global lock admits compatible peers
 * in either group. An opposite queued mode stops later peers in both policies.
 * Tickets own protection before interruptible readiness can begin. */
class SettlementLock {
  constructor(private readonly policy: "namespace" | "globalGroups") {}
  private readonly queue: Waiter[] = [];
  private readers = 0;
  private writers = 0;
  private closed: Cause.Cause<CoreError> | undefined;
  private readonly assertOpen: Effect.Effect<void, CoreError> = Effect.suspend(() => this.closed === undefined
    ? Effect.void : Effect.failCause(this.closed));

  private readonly pump = Effect.fn("CoreSettlementLock.pump")((): Effect.Effect<void> => Effect.suspend(() => {
    if (this.closed !== undefined) return Effect.void;
    const granted: Waiter[] = [];
    while (this.queue.length > 0) {
      const waiter = this.queue[0];
      if (waiter === undefined) break;
      if (waiter.mode === "shared" && this.writers !== 0 || waiter.mode === "exclusive"
        && (this.readers !== 0 || this.policy === "namespace" && this.writers !== 0)) break;
      this.queue.shift();
      waiter.state = "granted";
      if (waiter.mode === "shared") this.readers += 1;
      else this.writers += 1;
      granted.push(waiter);
      if (waiter.mode === "exclusive" && this.policy === "namespace") break;
    }
    return Effect.forEach(granted, waiter => Deferred.succeed(waiter.ready, undefined), { discard: true });
  }));

  private readonly release = Effect.fn("CoreSettlementLock.release")((waiter: Waiter): Effect.Effect<void> =>
    Effect.uninterruptible(Effect.gen({ self: this }, function* () {
      const previous = waiter.state;
      if (previous === "released") return;
      waiter.state = "released";
      if (previous === "granted") {
        if (waiter.mode === "shared") this.readers -= 1;
        else this.writers -= 1;
      } else if (previous === "waiting") {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
      }
      yield* Deferred.fail(waiter.ready, new CoreTransactionError({ reason: "closed" }));
      yield* this.pump();
    })));

  private readonly acquire = Effect.fn("CoreSettlementLock.acquire")((waiter: Waiter): Effect.Effect<void, CoreError> =>
    Effect.uninterruptibleMask(restore => Effect.gen({ self: this }, function* () {
      yield* this.assertOpen;
      if (waiter.state === "released") return yield* new CoreTransactionError({ reason: "closed" });
      if (waiter.state === "created") {
        waiter.state = "waiting";
        this.queue.push(waiter);
        yield* this.pump();
      }
      yield* restore(Deferred.await(waiter.ready));
      yield* this.assertOpen;
      if (waiter.state !== "granted") return yield* new CoreTransactionError({ reason: "closed" });
    })).pipe(Effect.onExit(exit => Exit.isFailure(exit) ? this.release(waiter) : Effect.void)));

  /** Allocation is inert; the owning bracket receives the ticket before ready. */
  request(mode: Waiter["mode"]): SettlementTicket {
    const waiter: Waiter = { mode, ready: Deferred.makeUnsafe<void, CoreError>(), state: "created" };
    return { ready: this.acquire(waiter), release: this.release(waiter) };
  }

  readonly close = Effect.fn("CoreSettlementLock.close")((cause: Cause.Cause<CoreError>): Effect.Effect<void> =>
    Effect.uninterruptible(Effect.suspend(() => {
      this.closed ??= cause;
      const waiting = this.queue.splice(0);
      for (const waiter of waiting) waiter.state = "released";
      return Effect.forEach(waiting, waiter => Deferred.failCause(waiter.ready, cause), { discard: true });
    })));
}

/** Private finalized-state evidence; never exposed through a native facade. */
export interface CoreNativeScopeExclusionGrant {
  readonly namespace: CoreTableNamespace;
  readonly assertHeld: Effect.Effect<void, CoreError>;
  readonly attach: () => Result.Result<void, CoreTransactionError>;
  readonly cancelAdmission: Effect.Effect<void>;
  readonly finalized: () => void;
  readonly accepted: () => void;
  readonly drain: Effect.Effect<void>;
  readonly settle: Effect.Effect<void>;
  readonly abandon: Effect.Effect<void>;
}
export type CoreSettlementPurpose = "namespace" | "global" | "requestControl";
const settlementAuthorizationBrand: unique symbol = Symbol("CoreSettlementAuthorization");
export interface CoreSettlementAuthorization { readonly [settlementAuthorizationBrand]: true }

/** One instance belongs to one already fenced and bootstrapped Core generation. */
export class CoreNativeScopeExclusion {
  /** Shared mode is the selected-native group; exclusive mode is the global
   * publication group. Peers within each group remain Source/OCC concurrent. */
  private readonly global = new SettlementLock("globalGroups");
  private readonly namespaces = new Map<string, SettlementLock>();
  private readonly grants = new WeakSet<CoreNativeScopeExclusionGrant>();
  private readonly settlements = new WeakMap<CoreSettlementAuthorization, Readonly<{
    transaction: CoreFinalizedState; purpose: CoreSettlementPurpose;
  }>>();
  private closed: Cause.Cause<CoreError> | undefined;

  private namespace(namespace: CoreTableNamespace): SettlementLock {
    const key = coreNamespaceKey(namespace);
    let lock = this.namespaces.get(key);
    if (lock === undefined) { lock = new SettlementLock("namespace"); this.namespaces.set(key, lock); }
    return lock;
  }
  readonly assertOpen: Effect.Effect<void, CoreError> = Effect.suspend(() => this.closed === undefined
    ? Effect.void : Effect.failCause(this.closed));

  private request(namespace: CoreTableNamespace, mode: "shared" | "exclusive"): SettlementTicket {
    const global = mode === "exclusive" ? this.global.request("shared") : undefined;
    const scoped = this.namespace(namespace).request(mode);
    return { release: Effect.andThen(scoped.release, global?.release ?? Effect.void), ready: Effect.gen({ self: this }, function* () {
      yield* this.assertOpen;
      if (global !== undefined) yield* global.ready;
      yield* this.assertOpen;
      yield* scoped.ready;
      yield* this.assertOpen;
    }) };
  }

  /** Only readiness is raced. Its ticket already has an owner on every Exit. */
  readonly beforeDeadline = Effect.fn("CoreNativeScopeExclusion.beforeDeadline")((work: Effect.Effect<void, CoreError>,
    deadline?: number): Effect.Effect<void, CoreError> => deadline === undefined ? work : Effect.gen(function* () {
      const remaining = deadline - (yield* Clock.currentTimeMillis);
      if (remaining <= 0) return yield* new CoreTransactionError({ reason: "admissionExpired" });
      yield* Effect.timeoutOrElse(work, { duration: Duration.millis(remaining),
        orElse: () => Effect.fail(new CoreTransactionError({ reason: "admissionExpired" })) });
    }));

  readonly acquireExclusive = Effect.fn("CoreNativeScopeExclusion.acquireExclusive")((namespace: CoreTableNamespace,
    deadline: number | undefined, ownGrant: (grant: CoreNativeScopeExclusionGrant) => void): Effect.Effect<CoreNativeScopeExclusionGrant, CoreError> =>
    Effect.uninterruptibleMask(restore => Effect.gen({ self: this }, function* () {
      const ticket = this.request(namespace, "exclusive");
      let entered = false, attached = false, cancelled = false, finalized = false, drained = false, settled = false, accepted = false;
      const release = Effect.suspend(() => drained && (!finalized || settled) ? ticket.release : Effect.void);
      const cancelAdmission = Effect.uninterruptible(Effect.suspend(() => {
        if (attached) return Effect.void;
        cancelled = true;
        return ticket.release;
      }));
      const grant: CoreNativeScopeExclusionGrant = Object.freeze({ namespace,
        assertHeld: Effect.andThen(this.assertOpen, Effect.suspend(() => !entered || cancelled || drained || settled
          ? Effect.fail(new CoreTransactionError({ reason: "authorityRevoked" })) : Effect.void)),
        attach: () => {
          if (!entered || cancelled || drained || settled) return Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
          attached = true;
          return Result.succeed(undefined);
        },
        cancelAdmission,
        finalized: () => { finalized = true; },
        accepted: () => { accepted = true; },
        drain: Effect.uninterruptible(Effect.suspend(() => {
          if (!attached) return cancelAdmission;
          drained = true;
          return release;
        })),
        settle: Effect.uninterruptible(Effect.andThen(Effect.sync(() => { settled = true; }), release)),
        abandon: Effect.uninterruptible(Effect.suspend(() => {
          if (accepted) return Effect.void;
          settled = true;
          return attached ? release : cancelAdmission;
        })),
      });
      this.grants.add(grant);
      // The authentic claim receives cleanup ownership before readiness starts,
      // including when a successful return is discarded by an outer observer.
      ownGrant(grant);
      return yield* Effect.gen({ self: this }, function* () {
        yield* restore(this.beforeDeadline(ticket.ready, deadline));
        yield* this.assertOpen;
        if (cancelled) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        entered = true;
        return grant;
      }).pipe(Effect.onExit(exit => Exit.isFailure(exit) ? grant.cancelAdmission : Effect.void));
    })));

  /** Called only by this generation's database after consuming its private vault.
   * The token cannot authorize a clone, changed result, or another generation. */
  readonly authorize = (transaction: CoreFinalizedState, purpose: CoreSettlementPurpose): CoreFinalizedState => {
    const authorization: CoreSettlementAuthorization = Object.freeze({ [settlementAuthorizationBrand]: true as const });
    const authorized = Object.freeze({ ...transaction, settlementAuthorization: authorization });
    this.settlements.set(authorization, { transaction: authorized, purpose });
    return authorized;
  };

  readonly settlement = Effect.fn("CoreNativeScopeExclusion.settlement")((transaction: CoreFinalizedState,
    ownPermit: (permit: CoreSettlementPermit) => void): Effect.Effect<CoreSettlementPermit, CoreError> =>
    Effect.uninterruptibleMask(restore => Effect.gen({ self: this }, function* () {
      yield* this.assertOpen;
      const authorization = transaction.settlementAuthorization;
      const issued = authorization === undefined ? undefined : this.settlements.get(authorization);
      if (authorization !== undefined && issued?.transaction !== transaction)
        return yield* new CoreTransactionError({ reason: "foreignFinalization" });
      const purpose = issued?.purpose ?? "namespace";
      const namespace = transaction.namespace, own = transaction.scopeExclusion;
      if (own !== undefined && (!this.grants.has(own) || purpose !== "namespace"
        || coreNamespaceKey(own.namespace) !== coreNamespaceKey(namespace)))
        return yield* new CoreTransactionError({ reason: "foreignFinalization" });
      // Self-settlement reuses BOTH holds; a queued global writer cannot deadlock it.
      const ticket: SettlementTicket = own !== undefined ? { ready: this.assertOpen, release: own.settle }
        : purpose === "requestControl" ? { ready: this.assertOpen, release: Effect.void }
          : purpose === "global" ? this.global.request("exclusive") : this.request(namespace, "shared");
      ownPermit(ticket);
      return yield* Effect.gen({ self: this }, function* () {
        yield* restore(this.beforeDeadline(ticket.ready, transaction.admissionDeadlineUnixMilliseconds));
        yield* this.assertOpen;
        return ticket;
      }).pipe(Effect.onExit(exit => Exit.isFailure(exit) ? ticket.release : Effect.void));
    })));

  readonly close = Effect.fn("CoreNativeScopeExclusion.close")((cause: Cause.Cause<CoreError> =
    Cause.fail(new CoreTransactionError({ reason: "closed" }))): Effect.Effect<void> => Effect.uninterruptible(Effect.suspend(() => {
      this.closed ??= cause;
      return Effect.andThen(this.global.close(this.closed),
        Effect.forEach(this.namespaces.values(), lock => lock.close(cause), { discard: true }));
    })));
}
