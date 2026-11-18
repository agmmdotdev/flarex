import { Effect, type Result } from "effect";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { ApplicationPointMutationRunnerHostV1Error, type PointMutationOccRuntimeNeutralRunnerV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import type { makePrivatePayloadReverseReadConsumerWithRuntime } from "../../src/privatePayloadReverseReadConsumer";
import { makePrivateSaveExecution, type PrivateSaveExecution } from "./privatePayloadSaveExecution";
import { runPrivateMixedWorkerd } from "./privateMixedWorkerd";
import type { PrivateReverseReadProfile } from "./privatePayloadReverseReadCommands";
import type { PrivatePayloadSaveFixture, PrivateSavePreparationFailure } from "./privatePayloadSaveFixture";

const source = (body: string) => `export default { functions: { write: { isMutation: true, isPublic: true,
  _handler: async ctx => { ${body} } } } };`;
type Hooks = Readonly<{
  beforeWorker?: () => Promise<void>;
  afterWorker?: () => Promise<void>;
  beforePublication?: Parameters<typeof makePrivateSaveExecution>[4];
  observations?: Parameters<typeof runPrivateMixedWorkerd>[4];
  onResponse?: (value: unknown) => void;
  onNative?: (method: string) => void;
  makeNative?: Parameters<typeof makePrivatePayloadReverseReadConsumerWithRuntime>[2];
}>;
const callback = (work: (() => Promise<void>) | undefined) => work === undefined ? Effect.void :
  Effect.tryPromise({ try: work, catch: cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause }) });
type Execution = ReturnType<PrivateSaveExecution["owner"]["executePreparedFiniteAttempt"]>;
type ServingResult = Readonly<{ execution: PrivateSaveExecution; result: Result.Result<Effect.Success<Execution>, Effect.Error<Execution>> }>;
type ServingFailure = PrivateSavePreparationFailure | Effect.Error<ReturnType<typeof makePrivateSaveExecution>>;

/** Trusted arrangement only. The production consumer supplies the same facade
 * to the real RPC/Worker transport for each genuine execution attempt. */
export const runPrivatePayloadReverseServing: (fixture: PrivatePayloadSaveFixture, profile: PrivateReverseReadProfile,
  policyId: AppDocumentIdV1, body: string, hooks?: Hooks) => Effect.Effect<ServingResult, ServingFailure> =
  Effect.fn("PrivatePayloadReverseFixture.serve")(function* (fixture, profile, policyId, body, hooks: Hooks = {}) {
    return yield* profile.withPreparation(preparation => Effect.gen(function* () {
      let execution: PrivateSaveExecution | undefined;
      const run: PointMutationOccRuntimeNeutralRunnerV1["run"] = Effect.fn("PrivatePayloadReverseFixture.run")(function* (input) {
        const active = execution;
        if (active === undefined) return yield* Effect.die(new Error("Missing genuine serving execution"));
        return yield* Effect.scoped(Effect.gen(function* () {
          const consumer = yield* active.bindReverseServing(policyId, input.journal, profile, hooks.makeNative);
          yield* callback(hooks.beforeWorker);
          const value = yield* runPrivateMixedWorkerd(input, consumer, source(body), hooks.onResponse ?? (() => {}), hooks.observations);
          yield* callback(hooks.afterWorker);
          return value;
        }));
      }, Effect.mapError(cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause })));
      const selected = yield* makePrivateSaveExecution(fixture, preparation, { run }, hooks.onNative, hooks.beforePublication,
        profile.withPreparation, new Map([["medusa.product", profile.borrow]]));
      execution = selected;
      const result = yield* selected.owner.executePreparedFiniteAttempt(selected.prepared).pipe(Effect.result);
      return { execution: selected, result };
    }));
  });
