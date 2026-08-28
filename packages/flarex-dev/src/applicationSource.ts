import {
  produceApplicationSource,
  type ApplicationPreparationPolicy,
  type ApplicationSource,
  type ApplicationSourceError,
} from "@flarex/application-definition";
import { Effect } from "effect";

import {
  prepareApplicationFromSdk,
  type LoadedSdkApplicationInput,
  type PrepareApplicationFromSdkError,
} from "./applicationDefinition.ts";

export type ProduceApplicationSourceFromSdkError =
  | PrepareApplicationFromSdkError
  | ApplicationSourceError;

export const produceApplicationSourceFromSdk: (
  input: LoadedSdkApplicationInput,
  policy: ApplicationPreparationPolicy,
) => Effect.Effect<ApplicationSource, ProduceApplicationSourceFromSdkError> =
  Effect.fn("FlarexDev.produceApplicationSourceFromSdk")(function* (
    input: LoadedSdkApplicationInput,
    policy: ApplicationPreparationPolicy,
  ): Effect.fn.Return<
    ApplicationSource,
    ProduceApplicationSourceFromSdkError
  > {
    const prepared = yield* prepareApplicationFromSdk(input, policy);
    return yield* Effect.fromResult(produceApplicationSource(prepared));
  });
