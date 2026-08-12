import type {
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { RpcTarget, type RpcStub } from "cloudflare:workers";
import { Cause, Effect, Exit, Result } from "effect";
import {
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";

import {
  InvalidPointMutationJournalCapabilityV1Error,
  type PointMutationJournalBoundaryV1Error,
  type PointMutationJournalIndexedQueryLogicalOutcomeV1,
  type PointMutationJournalLogicalOutcomeV1,
} from "./pointMutationJournal";
import {
  PointMutationJournalResultRejectedV1Error,
  type PointMutationJournalRpcBoundaryV1Error,
} from "./pointMutationJournalRpc";
import type {
  PointMutationOccBoundJournalV1,
} from "./storedAttemptAuthentication";

const REMOTE_STOP_ERROR_NAME = "FlarexApplicationJournalCapabilityStopped";
const REMOTE_STOP_ERROR_MESSAGE =
  "The Application journal capability is unavailable.";

export interface ApplicationPointMutationJournalCapabilityMethodsV1 {
  readonly revalidate: () => Promise<void>;
  readonly readPointDocument: (
    tableName: string,
    documentId: string,
  ) => Promise<unknown>;
  readonly queryIndexRange: (
    tableName: string,
    indexDescriptor: unknown,
    bounds: unknown,
    limit: number,
  ) => Promise<unknown>;
  readonly insertPointDocument: (
    tableName: string,
    value: unknown,
  ) => Promise<unknown>;
  readonly patchPointDocument: (
    documentId: string,
    value: unknown,
  ) => Promise<void>;
  readonly replacePointDocument: (
    documentId: string,
    value: unknown,
  ) => Promise<void>;
  readonly deletePointDocument: (documentId: string) => Promise<void>;
}

export type ApplicationPointMutationJournalCapabilityTargetV1 =
  & RpcTarget
  & ApplicationPointMutationJournalCapabilityMethodsV1;

export type ApplicationPointMutationJournalCapabilityStubV1 = RpcStub<
  ApplicationPointMutationJournalCapabilityTargetV1
>;

export interface ApplicationPointMutationJournalCapabilitySessionV1 {
  readonly target: ApplicationPointMutationJournalCapabilityTargetV1;
  readonly closeAndDrain: Effect.Effect<
    void,
    PointMutationJournalRpcBoundaryV1Error
  >;
}

export function makeApplicationPointMutationJournalCapabilitySessionV1(
  journal: PointMutationOccBoundJournalV1,
  bindings: ReadonlyArray<Readonly<{
    readonly logicalName: string;
    readonly tableId: number;
  }>>,
): ApplicationPointMutationJournalCapabilitySessionV1 {
  const state = new ApplicationPointMutationJournalCapabilityStateV1(
    journal,
    bindings,
  );
  return Object.freeze({
    target: new ApplicationPointMutationJournalCapabilityTarget(state),
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

class ApplicationPointMutationJournalCapabilityTarget
  extends RpcTarget
  implements ApplicationPointMutationJournalCapabilityMethodsV1
{
  readonly #state: ApplicationPointMutationJournalCapabilityStateV1;

  constructor(state: ApplicationPointMutationJournalCapabilityStateV1) {
    super();
    this.#state = state;
  }

  revalidate(): Promise<void> {
    return this.#state.revalidate();
  }

  readPointDocument(
    tableName: string,
    documentId: string,
  ): Promise<unknown> {
    return this.#state.run(async (syscallSequence) => {
      const table = await this.#state.resolvePointTable(tableName);
      return await this.#state.runPointOperation(table, {
        kind: "get",
        syscallSequence,
        documentId,
      });
    });
  }

  queryIndexRange(
    tableName: string,
    indexDescriptor: unknown,
    bounds: unknown,
    limit: number,
  ): Promise<unknown> {
    return this.#state.run(async (syscallSequence) => {
      const table = await this.#state.resolvePointTable(tableName);
      const index = await this.#state.resolveDeveloperIndex(
        table,
        indexDescriptor,
      );
      const result = await this.#state.runIndexedQuery(index, {
        kind: "indexRange",
        syscallSequence,
        bounds,
        limit,
      });
      return Object.freeze({
        documents: result.documents,
        isDone: result.isDone,
      });
    });
  }

  insertPointDocument(
    tableName: string,
    value: unknown,
  ): Promise<unknown> {
    return this.#state.run(async (syscallSequence) => {
      const table = await this.#state.resolvePointTable(tableName);
      const result = await this.#state.runPointOperation(table, {
        kind: "insert",
        syscallSequence,
        fields: value,
      });
      if (result.kind !== "inserted") throw invalidCapabilityResult();
      return result.documentId;
    });
  }

  patchPointDocument(documentId: string, value: unknown): Promise<void> {
    return this.#writeByDocumentId(documentId, {
      kind: "patch",
      patch: value,
    });
  }

  replacePointDocument(documentId: string, value: unknown): Promise<void> {
    return this.#writeByDocumentId(documentId, {
      kind: "replace",
      fields: value,
    });
  }

  deletePointDocument(documentId: string): Promise<void> {
    return this.#writeByDocumentId(documentId, { kind: "delete" });
  }

  #writeByDocumentId(
    documentId: string,
    operation:
      | Readonly<{ readonly kind: "patch"; readonly patch: unknown }>
      | Readonly<{ readonly kind: "replace"; readonly fields: unknown }>
      | Readonly<{ readonly kind: "delete" }>,
  ): Promise<void> {
    return this.#state.run(async (syscallSequence) => {
      const tableName = this.#state.tableNameForDocument(documentId);
      const table = await this.#state.resolvePointTable(tableName);
      const result = await this.#state.runPointOperation(table, {
        ...operation,
        syscallSequence,
        documentId,
      });
      if (result.kind !== "unit" || result.operation !== operation.kind) {
        throw invalidCapabilityResult();
      }
    });
  }
}

class ApplicationPointMutationJournalCapabilityStateV1 {
  readonly #journal: PointMutationOccBoundJournalV1;
  readonly #logicalNamesByTableId: ReadonlyMap<number, string>;
  readonly #failureCauses = new Map<
    number,
    Cause.Cause<PointMutationJournalRpcBoundaryV1Error>
  >();
  #accepting = true;
  #nextAdmission = 0;
  #nextSyscallSequence = 1n;
  #tail: Promise<void> = Promise.resolve();
  #drainPromise: Promise<void> | undefined;

  constructor(
    journal: PointMutationOccBoundJournalV1,
    bindings: ReadonlyArray<Readonly<{
      readonly logicalName: string;
      readonly tableId: number;
    }>>,
  ) {
    this.#journal = journal;
    this.#logicalNamesByTableId = new Map(
      bindings.map(binding => [binding.tableId, binding.logicalName]),
    );
  }

  revalidate(): Promise<void> {
    if (this.#accepting && this.firstCause() === undefined) {
      return Promise.resolve();
    }
    this.#retainLateCallFailure();
    return rejectedRemoteStopPromise();
  }

  tableNameForDocument(documentId: string): string {
    const identity = decodeAppDocumentIdentityV1Result(documentId);
    if (Result.isFailure(identity)) throw identity.failure;
    const logicalName = this.#logicalNamesByTableId.get(identity.success.tableId);
    if (logicalName === undefined) throw invalidCapabilityResult();
    return logicalName;
  }

  resolvePointTable(tableName: unknown) {
    return runJournalEffect(this.#journal.resolvePointTable(tableName));
  }

  resolveDeveloperIndex(table: Parameters<
    PointMutationOccBoundJournalV1["resolveDeveloperIndex"]
  >[0], indexDescriptor: unknown) {
    return runJournalEffect(
      this.#journal.resolveDeveloperIndex(table, indexDescriptor),
    );
  }

  runPointOperation(
    table: Parameters<PointMutationOccBoundJournalV1["runPointOperation"]>[0],
    operation: unknown,
  ): Promise<PointMutationJournalLogicalOutcomeV1> {
    return runJournalEffect(
      this.#journal.runPointOperation(table, operation).pipe(
        Effect.flatMap(projectPointOutcome),
      ),
    );
  }

  runIndexedQuery(
    index: Parameters<PointMutationOccBoundJournalV1["runIndexedQuery"]>[0],
    operation: unknown,
  ): Promise<PointMutationJournalIndexedQueryLogicalOutcomeV1> {
    return runJournalEffect(
      this.#journal.runIndexedQuery(index, operation).pipe(
        Effect.flatMap(projectIndexOutcome),
      ),
    );
  }

  run<A>(operation: (syscallSequence: bigint) => Promise<A>): Promise<A> {
    if (!this.#accepting) {
      this.#retainLateCallFailure();
      return rejectedRemoteStopPromise();
    }
    const admission = this.#nextAdmission++;
    const result = this.#tail.then(async () => {
      if (this.firstCause() !== undefined) throw makeRemoteStopError();
      const syscallSequence = this.#nextSyscallSequence;
      try {
        const value = await operation(syscallSequence);
        this.#nextSyscallSequence += 1n;
        return value;
      } catch (cause) {
        const documentValidation = documentValidationFailure(cause);
        if (documentValidation !== undefined) throw documentValidation;
        this.#retainCause(admission, cause);
        throw makeRemoteStopError();
      }
    });
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  closeAndDrain(): Promise<void> {
    this.#accepting = false;
    this.#drainPromise ??= this.#tail;
    return this.#drainPromise;
  }

  firstCause(): Cause.Cause<PointMutationJournalRpcBoundaryV1Error> | undefined {
    let firstAdmission: number | undefined;
    let firstCause: Cause.Cause<PointMutationJournalRpcBoundaryV1Error> | undefined;
    for (const [admission, cause] of this.#failureCauses) {
      if (firstAdmission === undefined || admission < firstAdmission) {
        firstAdmission = admission;
        firstCause = cause;
      }
    }
    return firstCause;
  }

  #retainLateCallFailure(): void {
    const admission = this.#nextAdmission++;
    this.#failureCauses.set(admission, Cause.fail(
      new InvalidPointMutationJournalCapabilityV1Error({
        capability: "attempt",
      }),
    ));
  }

  #retainCause(admission: number, cause: unknown): void {
    if (cause instanceof JournalEffectFailure) {
      this.#failureCauses.set(admission, cause.cause);
      return;
    }
    if (cause instanceof PointMutationJournalResultRejectedV1Error) {
      this.#failureCauses.set(admission, Cause.fail(cause));
      return;
    }
    if (cause instanceof InvalidPointMutationJournalCapabilityV1Error) {
      this.#failureCauses.set(admission, Cause.fail(cause));
      return;
    }
    const exit = cause instanceof Error && cause.name === REMOTE_STOP_ERROR_NAME
      ? undefined
      : cause;
    this.#failureCauses.set(
      admission,
      exit === undefined ? Cause.die(cause) : Cause.die(exit),
    );
  }
}

class JournalEffectFailure extends Error {
  readonly cause: Cause.Cause<PointMutationJournalRpcBoundaryV1Error>;

  constructor(cause: Cause.Cause<PointMutationJournalRpcBoundaryV1Error>) {
    super("Application journal Effect failed.");
    this.cause = cause;
  }
}

async function runJournalEffect<A>(
  effect: Effect.Effect<A, PointMutationJournalRpcBoundaryV1Error>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw new JournalEffectFailure(exit.cause);
}

function documentValidationFailure(
  cause: unknown,
): ApplicationRevisionSyscallDocumentValidationV1Error | undefined {
  if (!(cause instanceof JournalEffectFailure)) return undefined;
  const onlyReason = cause.cause.reasons.length === 1
    ? cause.cause.reasons[0]
    : undefined;
  return onlyReason !== undefined &&
      Cause.isFailReason(onlyReason) &&
      onlyReason.error instanceof
        ApplicationRevisionSyscallDocumentValidationV1Error
    ? onlyReason.error
    : undefined;
}

const projectPointOutcome = Effect.fn(
  "ApplicationPointMutationJournalCapability.projectPointOutcome",
)(function* (result: RunSessionJournalPointOperationV1Result) {
  if (result.kind === "completed") return result.outcome;
  return yield* new PointMutationJournalResultRejectedV1Error({ result });
});

const projectIndexOutcome = Effect.fn(
  "ApplicationPointMutationJournalCapability.projectIndexOutcome",
)(function* (result: RunSessionJournalIndexedQueryV1Result) {
  if (result.kind === "completed") return result.outcome;
  return yield* new PointMutationJournalResultRejectedV1Error({ result });
});

function rejectedRemoteStopPromise<A>(): Promise<A> {
  const result = Promise.reject<A>(makeRemoteStopError());
  void result.catch(() => undefined);
  return result;
}

function invalidCapabilityResult(): InvalidPointMutationJournalCapabilityV1Error {
  return new InvalidPointMutationJournalCapabilityV1Error({
    capability: "attempt",
  });
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
