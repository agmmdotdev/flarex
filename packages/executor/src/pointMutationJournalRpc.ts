import type {
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";
import { RpcTarget, type RpcStub } from "cloudflare:workers";
import { Cause, Effect, Exit } from "effect";

import type {
  PointMutationJournalBoundaryV1Error,
  PointMutationJournalTableV1,
} from "./pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
} from "./storedAttemptAuthentication";

const REMOTE_STOP_ERROR_NAME = "FlarexJournalRpcStopped";
const REMOTE_STOP_ERROR_MESSAGE = "The journal RPC capability is unavailable.";

export interface PointMutationJournalRpcTableMethodsV1 {
  readonly runPointOperation: (
    operation: unknown,
  ) => Promise<RunSessionJournalPointOperationV1Result>;
}

export type PointMutationJournalRpcTableTargetV1 =
  & RpcTarget
  & PointMutationJournalRpcTableMethodsV1;

export interface PointMutationJournalRpcParentMethodsV1 {
  readonly resolvePointTable: (
    tableName: unknown,
  ) => Promise<PointMutationJournalRpcTableTargetV1>;
}

export type PointMutationJournalRpcParentTargetV1 =
  & RpcTarget
  & PointMutationJournalRpcParentMethodsV1;

export type PointMutationJournalRpcTableStubV1 = RpcStub<
  PointMutationJournalRpcTableTargetV1
>;

export type PointMutationJournalRpcParentStubV1 = RpcStub<
  PointMutationJournalRpcParentTargetV1
>;

export interface PointMutationJournalRpcSessionV1 {
  readonly target: PointMutationJournalRpcParentTargetV1;
  readonly closeAndDrain: Effect.Effect<
    void,
    PointMutationJournalBoundaryV1Error,
    never
  >;
}

export function makePointMutationJournalRpcSessionV1(
  journal: PointMutationOccBoundJournalV1,
): PointMutationJournalRpcSessionV1 {
  const state = new PointMutationJournalRpcSessionStateV1(journal);
  return Object.freeze({
    target: new PointMutationJournalRpcParentTarget(state),
    closeAndDrain: Effect.uninterruptible(
      Effect.promise(() => state.closeAndDrain()).pipe(
        Effect.flatMap(() => {
          const cause = state.firstCause();
          return cause === undefined
            ? Effect.void
            : Effect.failCause(cause);
        }),
      ),
    ),
  });
}

class PointMutationJournalRpcParentTarget
  extends RpcTarget
  implements PointMutationJournalRpcParentMethodsV1
{
  readonly #state: PointMutationJournalRpcSessionStateV1;

  constructor(state: PointMutationJournalRpcSessionStateV1) {
    super();
    this.#state = state;
  }

  resolvePointTable(
    tableName: unknown,
  ): Promise<PointMutationJournalRpcTableTargetV1> {
    return this.#state.run(() => this.#state.journal.resolvePointTable(
      tableName,
    )).then(
      table => new PointMutationJournalRpcTableTarget(this.#state, table),
    );
  }
}

class PointMutationJournalRpcTableTarget
  extends RpcTarget
  implements PointMutationJournalRpcTableMethodsV1
{
  readonly #state: PointMutationJournalRpcSessionStateV1;
  readonly #table: PointMutationJournalTableV1;

  constructor(
    state: PointMutationJournalRpcSessionStateV1,
    table: PointMutationJournalTableV1,
  ) {
    super();
    this.#state = state;
    this.#table = table;
  }

  runPointOperation(
    operation: unknown,
  ): Promise<RunSessionJournalPointOperationV1Result> {
    return this.#state.run(() =>
      this.#state.journal.runPointOperation(this.#table, operation)
    );
  }
}

class PointMutationJournalRpcSessionStateV1 {
  readonly journal: PointMutationOccBoundJournalV1;
  readonly #admitted = new Set<Promise<void>>();
  readonly #failureCauses = new Map<
    number,
    Cause.Cause<PointMutationJournalBoundaryV1Error>
  >();
  #accepting = true;
  #nextAdmission = 0;
  #drainPromise: Promise<void> | undefined;

  constructor(journal: PointMutationOccBoundJournalV1) {
    this.journal = journal;
  }

  run<A>(
    makeEffect: () => Effect.Effect<
      A,
      PointMutationJournalBoundaryV1Error,
      never
    >,
  ): Promise<A> {
    if (!this.#accepting) {
      return Promise.reject(makeRemoteStopError());
    }
    const admission = this.#nextAdmission;
    this.#nextAdmission += 1;

    let result: Promise<A>;
    try {
      result = Effect.runPromiseExit(makeEffect()).then(
        exit => {
          if (Exit.isSuccess(exit)) return exit.value;
          this.#retainCause(admission, exit.cause);
          throw makeRemoteStopError();
        },
        cause => {
          this.#retainCause(admission, Cause.die(cause));
          throw makeRemoteStopError();
        },
      );
    } catch (cause) {
      this.#retainCause(admission, Cause.die(cause));
      result = Promise.reject(makeRemoteStopError());
    }

    const settlement = result.then(
      () => undefined,
      () => undefined,
    );
    this.#admitted.add(settlement);
    void settlement.then(() => {
      this.#admitted.delete(settlement);
    });
    return result;
  }

  closeAndDrain(): Promise<void> {
    this.#accepting = false;
    this.#drainPromise ??= this.#drainAdmitted();
    return this.#drainPromise;
  }

  firstCause():
    | Cause.Cause<PointMutationJournalBoundaryV1Error>
    | undefined {
    let earliestAdmission: number | undefined;
    let earliestCause:
      | Cause.Cause<PointMutationJournalBoundaryV1Error>
      | undefined;
    for (const [admission, cause] of this.#failureCauses) {
      if (
        earliestAdmission === undefined ||
        admission < earliestAdmission
      ) {
        earliestAdmission = admission;
        earliestCause = cause;
      }
    }
    return earliestCause;
  }

  #retainCause(
    admission: number,
    cause: Cause.Cause<PointMutationJournalBoundaryV1Error>,
  ): void {
    this.#failureCauses.set(admission, cause);
  }

  async #drainAdmitted(): Promise<void> {
    while (this.#admitted.size > 0) {
      await Promise.all(this.#admitted);
      await Promise.resolve();
    }
  }
}

function makeRemoteStopError(): Error {
  const error = new Error(REMOTE_STOP_ERROR_MESSAGE);
  error.name = REMOTE_STOP_ERROR_NAME;
  Object.defineProperty(error, "stack", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  return error;
}
