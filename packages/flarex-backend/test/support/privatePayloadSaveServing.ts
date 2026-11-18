import { Effect, type Result } from "effect";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { ApplicationPointMutationRunnerHostV1Error,
  type PointMutationOccRuntimeNeutralRunnerV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import { makePrivateSaveExecution, type PrivateSaveExecution } from "./privatePayloadSaveExecution";
import { runPrivateMixedWorkerd } from "./privateMixedWorkerd";
import type { PrivatePayloadSaveFixture, PrivateSavePreparationFailure } from "./privatePayloadSaveFixture";

const source = (body: string) => `export default { functions: { write: { isMutation: true, isPublic: true,
  _handler: async ctx => { ${body} } } } };`;
type Hooks = Readonly<{
  fresh?: boolean;
  beforeEntry?: () => Promise<void>;
  beforeWorker?: () => Promise<void>;
  afterWorker?: () => Promise<void>;
  beforePublication?: Parameters<typeof makePrivateSaveExecution>[4];
  observations?: Parameters<typeof runPrivateMixedWorkerd>[4];
  onResponse?: (value: unknown) => void;
  onNative?: (method: string) => void;
}>;
const callback = (work: (() => Promise<void>) | undefined) => work === undefined ? Effect.void :
  Effect.tryPromise({ try: work, catch: cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause }) });
type Execution = ReturnType<PrivateSaveExecution["owner"]["executePreparedFiniteAttempt"]>;
type ServingResult = Readonly<{ execution: PrivateSaveExecution; result: Result.Result<Effect.Success<Execution>, Effect.Error<Execution>> }>;
type ServingFailure = PrivateSavePreparationFailure | ApplicationPointMutationRunnerHostV1Error |
  Effect.Error<ReturnType<typeof makePrivateSaveExecution>>;

/** Test arrangement over the selected production consumer and real execution
 * owner. Hooks run outside SQL transactions and never decide acceptance. */
export const runPrivatePayloadSaveServing: (
  fixture: PrivatePayloadSaveFixture, policyId: AppDocumentIdV1, body: string, hooks?: Hooks,
) => Effect.Effect<ServingResult, ServingFailure> = Effect.fn("PrivatePayloadSaveFixture.serve")(function* (
  fixture: PrivatePayloadSaveFixture, policyId: AppDocumentIdV1, body: string, hooks: Hooks = {},
) {
  const prepare = hooks.fresh === true ? fixture.withFreshPreparation : fixture.withPreparation;
  return yield* prepare(preparation => Effect.gen(function* () {
    let execution: PrivateSaveExecution | undefined;
    const run: PointMutationOccRuntimeNeutralRunnerV1["run"] = Effect.fn("PrivatePayloadSaveFixture.run")(function* (input) {
      const active = execution;
      if (active === undefined) return yield* Effect.die(new Error("Missing genuine serving execution"));
      return yield* Effect.scoped(Effect.gen(function* () {
        const consumer = yield* active.bindServing(policyId, input.journal);
        yield* callback(hooks.beforeWorker);
        const value = yield* runPrivateMixedWorkerd(input, consumer, source(body), hooks.onResponse ?? (() => {}), hooks.observations);
        yield* callback(hooks.afterWorker);
        return value;
      }));
    }, Effect.mapError(cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause })));
    const selected = yield* makePrivateSaveExecution(fixture, preparation, { run }, hooks.onNative, hooks.beforePublication);
    execution = selected;
    yield* callback(hooks.beforeEntry);
    const result = yield* selected.owner.executePreparedFiniteAttempt(selected.prepared).pipe(Effect.result);
    return { execution: selected, result };
  }));
});
