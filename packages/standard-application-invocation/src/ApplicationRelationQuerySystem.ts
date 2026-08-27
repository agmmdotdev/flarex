import {
  openApplicationRelationQuerySnapshot,
  readApplicationRelationQueryIncomingSources,
  readApplicationRelationQueryIncomingSourcesWithSyncReceipt,
  type ApplicationRelationQueryPage,
  type ApplicationRelationQueryPageWithSyncReceipt,
  type ApplicationRelationQuerySnapshotContext,
  type OpenApplicationRelationQuerySnapshotError,
  type UseApplicationRelationQuerySnapshotError,
} from
  "@flarex/persistence-postgres/internal/application-query-snapshot";
import type {
  ApplicationActiveSelection,
  ApplicationRelationActivationRepository,
} from "@flarex/persistence-postgres/internal/application-activation";
import {
  ScopeExecution,
  ScopeExecutionLive,
  type ScopeExecutionApi,
} from "@flarex/persistence-postgres/internal/scope-execution";
import { Context, Effect, Layer } from "effect";

import {
  ApplicationRelationQueryInputError,
  decodeTakeIncomingRelationSourcesInput,
  type TakeIncomingRelationSourcesInput,
} from "./ApplicationRelationQueryInput";

export {
  ApplicationRelationQueryInputError,
  decodeTakeIncomingRelationSourcesInput,
  type TakeIncomingRelationSourcesInput,
} from "./ApplicationRelationQueryInput";

export type TakeIncomingRelationSourcesResult = ApplicationRelationQueryPage;

export type TakeIncomingRelationSourcesWithSyncReceiptResult =
  ApplicationRelationQueryPageWithSyncReceipt;

export type ApplicationSelectionRelationQueryError =
  | OpenApplicationRelationQuerySnapshotError
  | UseApplicationRelationQuerySnapshotError;

export type TakeIncomingRelationSourcesError =
  | ApplicationRelationQueryInputError
  | Effect.Error<ReturnType<
    ApplicationRelationActivationRepository<unknown, unknown>["readActive"]
  >>
  | ApplicationSelectionRelationQueryError;

export interface ApplicationSelectionRelationQueryPort {
  readonly takeIncomingRelationSources: (
    selection: ApplicationActiveSelection,
    input: TakeIncomingRelationSourcesInput,
  ) => Effect.Effect<
    TakeIncomingRelationSourcesResult,
    ApplicationSelectionRelationQueryError
  >;
  readonly takeIncomingRelationSourcesWithSyncReceipt: (
    selection: ApplicationActiveSelection,
    input: TakeIncomingRelationSourcesInput,
  ) => Effect.Effect<
    TakeIncomingRelationSourcesWithSyncReceiptResult,
    ApplicationSelectionRelationQueryError
  >;
}

export interface ApplicationRelationQuerySystemLive {
  readonly activation: Pick<
    ApplicationRelationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly snapshot: ApplicationRelationQuerySnapshotContext;
}

export interface ApplicationRelationQuerySystemApi {
  readonly selectionRelation: ApplicationSelectionRelationQueryPort;
  readonly takeIncomingRelationSources: (
    input: unknown,
  ) => Effect.Effect<
    TakeIncomingRelationSourcesResult,
    TakeIncomingRelationSourcesError
  >;
}

export class ApplicationRelationQuerySystem extends Context.Service<
  ApplicationRelationQuerySystem,
  ApplicationRelationQuerySystemApi
>()(
  "flarex/standard-application-invocation/ApplicationRelationQuerySystem",
) {}

export const takeIncomingRelationSources = Effect.fn(
  "ApplicationRelationQuery.takeIncomingRelationSources",
)(function* (
  input: unknown,
): Effect.fn.Return<
  TakeIncomingRelationSourcesResult,
  TakeIncomingRelationSourcesError,
  ApplicationRelationQuerySystem
> {
  const system = yield* ApplicationRelationQuerySystem;
  return yield* system.takeIncomingRelationSources(input);
});

export function makeApplicationRelationQuerySystemLayer(
  live: ApplicationRelationQuerySystemLive,
): Layer.Layer<ApplicationRelationQuerySystem> {
  const captured = captureLive(live);
  return Layer.effect(
    ApplicationRelationQuerySystem,
    Effect.gen(function* () {
      const selectionRelation =
        yield* makeApplicationSelectionRelationQueryPort({
          snapshot: captured.snapshot,
        });
      return ApplicationRelationQuerySystem.of(Object.freeze({
        selectionRelation,
        takeIncomingRelationSources: makeActiveTakeIncomingRelationSources(
          captured.activation,
          selectionRelation,
        ),
      }));
    }),
  ).pipe(Layer.provide(ScopeExecutionLive));
}

export const makeApplicationSelectionRelationQueryPort = Effect.fn(
  "ApplicationSelectionRelationQueryPort.make",
)(function* (
  live: Pick<ApplicationRelationQuerySystemLive, "snapshot">,
) {
  const snapshot = live.snapshot;
  const scopeExecution = yield* ScopeExecution;
  return Object.freeze({
    takeIncomingRelationSources: makeSelectionTakeIncomingRelationSources(
      snapshot,
      scopeExecution,
    ),
    takeIncomingRelationSourcesWithSyncReceipt:
      makeSelectionTakeIncomingRelationSourcesWithSyncReceipt(
        snapshot,
        scopeExecution,
      ),
  }) satisfies ApplicationSelectionRelationQueryPort;
});

function captureLive(
  live: ApplicationRelationQuerySystemLive,
): ApplicationRelationQuerySystemLive {
  const activationOwner = live.activation;
  const readActive = activationOwner.readActive;
  return Object.freeze({
    activation: Object.freeze({
      readActive: () => readActive.call(activationOwner),
    }),
    snapshot: live.snapshot,
  });
}

function makeActiveTakeIncomingRelationSources(
  activation: ApplicationRelationQuerySystemLive["activation"],
  selectionRelation: ApplicationSelectionRelationQueryPort,
): ApplicationRelationQuerySystemApi["takeIncomingRelationSources"] {
  return Effect.fn(
    "ApplicationRelationQuerySystem.takeIncomingRelationSources",
  )(function* (input) {
    const captured = yield* Effect.fromResult(
      decodeTakeIncomingRelationSourcesInput(input),
    );
    const active = yield* activation.readActive();
    return yield* selectionRelation.takeIncomingRelationSources(
      active.selection,
      captured,
    );
  });
}

function makeSelectionTakeIncomingRelationSources(
  snapshotContext: ApplicationRelationQuerySnapshotContext,
  scopeExecution: ScopeExecutionApi,
): ApplicationSelectionRelationQueryPort["takeIncomingRelationSources"] {
  return Effect.fn(
    "ApplicationSelectionRelationQueryPort.takeIncomingRelationSources",
  )((selection, input) => Effect.scoped(
    openApplicationRelationQuerySnapshot(
      selection,
      input.relation,
      snapshotContext,
    ).pipe(
      Effect.provideService(ScopeExecution, scopeExecution),
      Effect.flatMap(opened => readApplicationRelationQueryIncomingSources(
        opened.snapshot,
        input.target,
        input.limit,
      )),
    ),
  ));
}

function makeSelectionTakeIncomingRelationSourcesWithSyncReceipt(
  snapshotContext: ApplicationRelationQuerySnapshotContext,
  scopeExecution: ScopeExecutionApi,
): ApplicationSelectionRelationQueryPort[
  "takeIncomingRelationSourcesWithSyncReceipt"
] {
  return Effect.fn(
    "ApplicationSelectionRelationQueryPort.takeIncomingRelationSourcesWithSyncReceipt",
  )((selection, input) => Effect.scoped(
    openApplicationRelationQuerySnapshot(
      selection,
      input.relation,
      snapshotContext,
    ).pipe(
      Effect.provideService(ScopeExecution, scopeExecution),
      Effect.flatMap(opened =>
        readApplicationRelationQueryIncomingSourcesWithSyncReceipt(
          opened.snapshot,
          input.target,
          input.limit,
        )
      ),
    ),
  ));
}
