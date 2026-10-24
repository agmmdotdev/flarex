import { Cause, Deferred, Effect, Exit, Fiber, Queue, Result, Scope } from "effect";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { commerceError, type CommerceTransactionError } from "./model";

export interface CommerceOperations {
  /** Capture and charge owned inputs before waiting. The complete work callback,
   * including its participant lifetime and receipt, holds one FIFO position. */
  readonly submit: <Prepared, Value>(prepare: () => Result.Result<Prepared, CommerceTransactionError>,
    work: (prepared: Prepared) => Effect.Effect<Value, CommerceTransactionError>) => Effect.Effect<Value, CommerceTransactionError>;
  /** Complete the callback once, retaining its full Exit and any independent
   * queue failure. Failed completion is not a new admission checkpoint. */
  readonly finalize: <Value>(body: Exit.Exit<Value, CommerceTransactionError>) => Effect.Effect<Value, CommerceTransactionError>;
  /** Revoke first, interrupt and join the owned worker before the database exits. */
  readonly close: Effect.Effect<void>;
}

interface Job {
  readonly run: Effect.Effect<void, CommerceTransactionError>;
  readonly reject: (cause: Cause.Cause<CommerceTransactionError>) => Effect.Effect<void>;
}

/** Trusted bounded FIFO. The owner selects an authenticated context and retains
 * every low-level overlap check; no database or settlement authority is added. */
export const makeCommerceOperations = Effect.fn("Commerce.makeOperations")(function* (
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, callLimit: number,
  context: BoundedRequestContext, checkAdmission = false,
): Effect.fn.Return<CommerceOperations, CommerceTransactionError> {
  if (!Number.isSafeInteger(callLimit) || callLimit < 1) return yield* Effect.fail(commerceError("invalidInput"));
  const queue = yield* Queue.bounded<Job>(callLimit);
  const scope = yield* Scope.make();
  const pending = new Set<Job>();
  let phase: "open" | "sealed" | "failed" | "closed" = "open";
  let accepted = 0;
  let firstCause: Cause.Cause<CommerceTransactionError> | undefined;
  let worker: Fiber.Fiber<void, CommerceTransactionError> | undefined;
  const latch = (cause: Cause.Cause<CommerceTransactionError>) => {
    firstCause ??= cause;
    if (phase === "open") phase = "failed";
  };
  const rejectPending = (cause: Cause.Cause<CommerceTransactionError>) => Effect.gen(function* () {
    yield* Queue.shutdown(queue);
    for (const job of pending) yield* job.reject(cause);
    pending.clear();
  });
  const abort = (cause: Cause.Cause<CommerceTransactionError>) => Effect.uninterruptible(Effect.gen(function* () {
    if (phase !== "closed") latch(cause);
    yield* rejectPending(firstCause ?? cause);
    if (worker !== undefined) yield* Fiber.interrupt(worker);
  }));
  const loop = Effect.whileLoop({ while: () => phase === "open",
    body: () => Queue.take(queue).pipe(Effect.flatMap(job => job.run)), step: () => {} });
  worker = yield* Effect.forkIn(Effect.interruptible(loop.pipe(Effect.onExit(exit => {
    if (Exit.isFailure(exit) && phase !== "closed") latch(exit.cause);
    return rejectPending(firstCause ?? Cause.fail(commerceError("closed")));
  }))), scope);

  const submit: CommerceOperations["submit"] = <Prepared, Value>(
    prepare: () => Result.Result<Prepared, CommerceTransactionError>,
    work: (prepared: Prepared) => Effect.Effect<Value, CommerceTransactionError>,
  ) => Effect.uninterruptibleMask(restore => {
    let finished = false;
    // Root jobs may be admitted while their participant child is active. A
    // borrowed queue instead requires its exact manager at admission, so a
    // parent cannot submit work while a deeper borrow owns the context.
    const admit = Effect.suspend(() => {
      if (firstCause !== undefined) return Effect.failCause(firstCause);
      if (phase !== "open") return Effect.fail(commerceError("closed"));
      return lifetime.withinDeadline((checkAdmission ? lifetime.checkpoint(context) : Effect.void).pipe(Effect.andThen(Effect.suspend(() => {
        if (firstCause !== undefined) return Effect.failCause(firstCause);
        if (phase !== "open") return Effect.fail(commerceError("closed"));
        if (accepted >= callLimit || lifetime.usedCalls() >= callLimit) return Effect.fail(commerceError("limitExceeded"));
        return lifetime.fromResult(prepare()).pipe(Effect.map(prepared => {
          const reply = Deferred.makeUnsafe<Value, CommerceTransactionError>();
          const complete = (exit: Exit.Exit<Value, CommerceTransactionError>) => Effect.gen(function* () {
            if (Exit.isFailure(exit) && phase !== "closed") latch(exit.cause);
            finished = true;
            pending.delete(job);
            yield* Deferred.done(reply, exit);
          });
          const job: Job = {
            run: lifetime.withinDeadline(lifetime.checkpoint(context).pipe(
              Effect.andThen(() => work(prepared)),
            )).pipe(Effect.onExit(complete), Effect.asVoid),
            reject: cause => complete(Exit.failCause(cause)),
          };
          accepted++;
          pending.add(job);
          // Total accepted jobs never exceed queue capacity, including the
          // active job. This offer is synchronous and cannot suspend admission.
          if (!Queue.offerUnsafe(queue, job)) throw new Error("Commerce operation queue rejected an admitted job");
          return reply;
        }));
      }))));
    });
    return admit.pipe(Effect.flatMap(reply => restore(Deferred.await(reply))),
      Effect.onExit(exit => Exit.isFailure(exit) && !finished && phase !== "closed" ? abort(exit.cause) : Effect.void));
  });
  const finalize: CommerceOperations["finalize"] = body => Effect.suspend(() => {
    let complete = firstCause;
    if (Exit.isFailure(body)) complete = complete === undefined ? body.cause : Cause.combine(complete, body.cause);
    const refusal = phase === "closed" || phase === "sealed" ? "closed"
      : pending.size !== 0 ? "overlappingOperation" : undefined;
    if (refusal !== undefined) {
      const cause = Cause.fail(commerceError(refusal));
      complete = complete === undefined ? cause : Cause.combine(complete, cause);
    }
    if (complete !== undefined) {
      const terminal = complete;
      if (phase !== "closed") {
        firstCause = terminal;
        phase = "failed";
      }
      // Flush and native callback failures can occur outside queued jobs. Keep
      // their authentic complete Cause before child revocation, without
      // manufacturing rollbackOnly by checking an already-failed lifetime.
      return Exit.isFailure(body) ? Result.match(lifetime.recordFailure(context, terminal), {
        onSuccess: owned => Effect.failCause(owned),
        onFailure: error => Effect.failCause(Cause.combine(terminal, Cause.fail(error))),
      }) : Effect.failCause(terminal);
    }
    phase = "sealed";
    return lifetime.checkpoint(context).pipe(Effect.onExit(exit => {
      if (Exit.isFailure(exit)) latch(exit.cause);
      return Effect.void;
    }), Effect.andThen(body));
  });
  const close = Effect.uninterruptible(Effect.gen(function* () {
    phase = "closed";
    yield* rejectPending(firstCause ?? Cause.fail(commerceError("closed")));
    yield* Scope.close(scope, Exit.void);
  }));
  return Object.freeze({ submit, finalize, close });
}, Effect.uninterruptible);
