import type {
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";
import { RpcTarget, type RpcStub } from "cloudflare:workers";
import { Cause, Data, Effect, Exit } from "effect";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";

import type {
  PointMutationJournalBoundaryV1Error,
  PointMutationJournalLogicalOutcomeV1,
  PointMutationJournalIndexedQueryLogicalOutcomeV1,
  PointMutationJournalIndexV1,
  PointMutationJournalTableV1,
} from "./pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
} from "./storedAttemptAuthentication";

const REMOTE_STOP_ERROR_NAME = "FlarexJournalRpcStopped";
const REMOTE_STOP_ERROR_MESSAGE = "The journal RPC capability is unavailable.";

export class PointMutationJournalResultRejectedV1Error
  extends Data.TaggedError("PointMutationJournalResultRejectedV1Error")<{
    readonly result: Exclude<
      | RunSessionJournalPointOperationV1Result
      | RunSessionJournalIndexedQueryV1Result,
      { readonly kind: "completed" }
    >;
  }> {}

export type PointMutationJournalRpcBoundaryV1Error =
  | PointMutationJournalBoundaryV1Error
  | PointMutationJournalResultRejectedV1Error;

export interface PointMutationJournalRpcTableMethodsV1 {
  readonly runPointOperation: (
    operation: unknown,
  ) => Promise<PointMutationJournalLogicalOutcomeV1>;
  readonly resolveDeveloperIndex: (
    indexDescriptor: unknown,
  ) => Promise<PointMutationJournalRpcIndexTargetV1>;
}

export interface PointMutationJournalRpcIndexMethodsV1 {
  readonly runIndexedQuery: (
    operation: unknown,
  ) => Promise<PointMutationJournalIndexedQueryLogicalOutcomeV1>;
}

export type PointMutationJournalRpcIndexTargetV1 =
  & RpcTarget
  & PointMutationJournalRpcIndexMethodsV1;

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

export type PointMutationJournalRpcIndexStubV1 = RpcStub<
  PointMutationJournalRpcIndexTargetV1
>;

export type PointMutationJournalRpcParentStubV1 = RpcStub<
  PointMutationJournalRpcParentTargetV1
>;

export interface PointMutationJournalRpcSessionV1 {
  readonly target: PointMutationJournalRpcParentTargetV1;
  readonly closeAndDrain: Effect.Effect<
    void,
    PointMutationJournalRpcBoundaryV1Error,
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
      // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: lifecycle - admitted drain promises settle with then(void, void) and cannot reject
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
  ): Promise<PointMutationJournalLogicalOutcomeV1> {
    return this.#state.runPointOperation(() =>
      this.#state.journal.runPointOperation(this.#table, operation).pipe(
        Effect.flatMap(projectPointMutationJournalRpcOutcomeV1),
      )
    );
  }

  resolveDeveloperIndex(
    indexDescriptor: unknown,
  ): Promise<PointMutationJournalRpcIndexTargetV1> {
    return this.#state.run(() => this.#state.journal.resolveDeveloperIndex(
      this.#table,
      indexDescriptor,
    )).then(
      index => new PointMutationJournalRpcIndexTarget(this.#state, index),
    );
  }
}

class PointMutationJournalRpcIndexTarget
  extends RpcTarget
  implements PointMutationJournalRpcIndexMethodsV1
{
  readonly #state: PointMutationJournalRpcSessionStateV1;
  readonly #index: PointMutationJournalIndexV1;

  constructor(
    state: PointMutationJournalRpcSessionStateV1,
    index: PointMutationJournalIndexV1,
  ) {
    super();
    this.#state = state;
    this.#index = index;
  }

  runIndexedQuery(
    operation: unknown,
  ): Promise<PointMutationJournalIndexedQueryLogicalOutcomeV1> {
    return this.#state.run(() =>
      this.#state.journal.runIndexedQuery(this.#index, operation).pipe(
        Effect.flatMap(projectPointMutationJournalIndexedQueryRpcOutcomeV1),
      )
    );
  }
}

const projectPointMutationJournalRpcOutcomeV1 = Effect.fn(
  "PointMutationJournalRpc.projectOutcome",
)(function* (
  result: RunSessionJournalPointOperationV1Result,
): Effect.fn.Return<
  PointMutationJournalLogicalOutcomeV1,
  PointMutationJournalResultRejectedV1Error
> {
  switch (result.kind) {
    case "completed":
      return result.outcome;
    case "rejected":
    case "sequenceRejected":
    case "stateRejected":
      return yield* Effect.fail(
        new PointMutationJournalResultRejectedV1Error({ result }),
      );
  }
});

const projectPointMutationJournalIndexedQueryRpcOutcomeV1 = Effect.fn(
  "PointMutationJournalRpc.projectIndexedQueryOutcome",
)(function* (
  result: RunSessionJournalIndexedQueryV1Result,
): Effect.fn.Return<
  PointMutationJournalIndexedQueryLogicalOutcomeV1,
  PointMutationJournalResultRejectedV1Error
> {
  switch (result.kind) {
    case "completed":
      return result.outcome;
    case "rejected":
    case "sequenceRejected":
    case "stateRejected":
      return yield* Effect.fail(
        new PointMutationJournalResultRejectedV1Error({ result }),
      );
  }
});

class PointMutationJournalRpcSessionStateV1 {
  readonly journal: PointMutationOccBoundJournalV1;
  readonly #admitted = new Set<Promise<void>>();
  readonly #failureCauses = new Map<
    number,
    Cause.Cause<PointMutationJournalRpcBoundaryV1Error>
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
      PointMutationJournalRpcBoundaryV1Error,
      never
    >,
  ): Promise<A> {
    return this.#run(makeEffect, false);
  }

  runPointOperation<A>(
    makeEffect: () => Effect.Effect<
      A,
      PointMutationJournalRpcBoundaryV1Error,
      never
    >,
  ): Promise<A> {
    return this.#run(makeEffect, true);
  }

  #run<A>(
    makeEffect: () => Effect.Effect<
      A,
      PointMutationJournalRpcBoundaryV1Error,
      never
    >,
    recoverDocumentValidation: boolean,
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
          const onlyReason = exit.cause.reasons.length === 1
            ? exit.cause.reasons[0]
            : undefined;
          if (
            recoverDocumentValidation &&
            onlyReason !== undefined &&
            Cause.isFailReason(onlyReason) &&
            onlyReason.error instanceof
              ApplicationRevisionSyscallDocumentValidationV1Error
          ) {
            throw onlyReason.error;
          }
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
    | Cause.Cause<PointMutationJournalRpcBoundaryV1Error>
    | undefined {
    let earliestAdmission: number | undefined;
    let earliestCause:
      | Cause.Cause<PointMutationJournalRpcBoundaryV1Error>
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
    cause: Cause.Cause<PointMutationJournalRpcBoundaryV1Error>,
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
