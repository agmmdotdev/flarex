import { Effect, Result } from "effect";

import type {
  AdmittedChangeSource,
  ChangeReadBudget,
  ChangeSourceReadRequest,
} from "../change/Model.js";
import {
  captureNamespaceCursor,
  type NamespaceCursor,
} from "../kernel/Model.js";
import {
  catchUpNamespace,
  makeTurnRuntime,
} from "./CatchUp.js";
import type {
  CatchUpTurnError,
  NamespaceCatchUpConstructionError,
} from "./Errors.js";
import {
  captureCatchUpTurnBudget,
  captureNamespaceQuerySyncPolicy,
  freezeTurnProgress,
  makeTurnLedger,
} from "./Model.js";
import type {
  CatchUpTurnBudget,
  CatchUpTurnOutcome,
  NamespaceQuerySyncPolicy,
} from "./Model.js";
import type { QuerySyncCatchUpState } from "./Ports.js";

export interface NamespaceCatchUpInput {
  readonly bootstrapCursor: NamespaceCursor;
  readonly source: AdmittedChangeSource;
  readonly state: QuerySyncCatchUpState;
  readonly policy: NamespaceQuerySyncPolicy;
}

export interface NamespaceCatchUp {
  readonly catchUp: (
    budget: CatchUpTurnBudget,
  ) => Effect.Effect<CatchUpTurnOutcome, CatchUpTurnError, never>;
}

export function captureAdmittedChangeSource(
  source: AdmittedChangeSource,
): AdmittedChangeSource {
  const readAfter = source.readAfter;
  const capturedReadAfter: AdmittedChangeSource["readAfter"] = (
    request: ChangeSourceReadRequest,
    budget: ChangeReadBudget,
  ) => readAfter.call(source, request, budget);
  return Object.freeze({ readAfter: capturedReadAfter });
}

export function captureQuerySyncCatchUpState(
  state: QuerySyncCatchUpState,
): QuerySyncCatchUpState {
  const initializeOrInspectNamespace = state.initializeOrInspectNamespace;
  const applyAdmittedBatchAndAdvance = state.applyAdmittedBatchAndAdvance;
  return Object.freeze({
    initializeOrInspectNamespace: cursor =>
      initializeOrInspectNamespace.call(state, cursor),
    applyAdmittedBatchAndAdvance: batch =>
      applyAdmittedBatchAndAdvance.call(state, batch),
  });
}

export function makeCatchUpOperation(
  input: NamespaceCatchUpInput,
): NamespaceCatchUp["catchUp"] {
  return Effect.fn("QuerySync.Namespace.catchUp")(function*(
    budgetInput,
  ): Effect.fn.Return<CatchUpTurnOutcome, CatchUpTurnError, never> {
    const budget = yield* Effect.fromResult(captureCatchUpTurnBudget(
      "catchUp",
      budgetInput,
      input.policy.settlementReserveMilliseconds,
    ));
    const runtime = yield* makeTurnRuntime({
      bootstrapCursor: input.bootstrapCursor,
      source: input.source,
      state: input.state,
      policy: input.policy,
      budget,
      ledger: makeTurnLedger(input.bootstrapCursor),
    });
    const outcome = yield* catchUpNamespace(runtime, "initialCatchUp");
    if (outcome._tag !== "caughtUp") return outcome;
    return Object.freeze({
      _tag: "caughtUp",
      cursor: outcome.cursor,
      authority: outcome.authority,
      progress: freezeTurnProgress(runtime.ledger),
    });
  });
}

export function makeNamespaceCatchUp(
  input: NamespaceCatchUpInput,
): Result.Result<NamespaceCatchUp, NamespaceCatchUpConstructionError> {
  return Result.gen(function* () {
    const bootstrapCursor = yield* captureNamespaceCursor(
      input.bootstrapCursor,
    );
    const policy = yield* captureNamespaceQuerySyncPolicy(
      input.policy,
      "makeNamespaceCatchUp",
    );
    const source = captureAdmittedChangeSource(input.source);
    const state = captureQuerySyncCatchUpState(input.state);
    return Object.freeze({
      catchUp: makeCatchUpOperation({
        bootstrapCursor,
        source,
        state,
        policy,
      }),
    });
  });
}
