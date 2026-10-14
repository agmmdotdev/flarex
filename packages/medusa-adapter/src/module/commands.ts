import { Effect, type Result } from "effect";
import { defineCommerceCommand, type CommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceTransactionError, Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PreparedCommerceModule } from "./definition";
import { defineGraphReadCommand, type GraphReadCommand } from "../local-graph/commands";

type Prepare<Input> = (ctx: CommerceCommandContext, input: Json) => Effect.Effect<Input, CommerceTransactionError>;
type Invoke<Service, Input> = (service: Service, input: Input) => Promise<unknown>;
type Project<Input> = (result: Json, input: Input) => Json;

/** Preserve module decoding, detached ownership and sticky refusal in that order.
 * The command's input boundary already owns JSON capture and byte accounting. */
export function commerceCommandPreparation(name: string) {
  return <Input>(decode: (input: unknown) => Result.Result<Input, CommerceTransactionError>): Prepare<Input> =>
    Effect.fn(name)((ctx: CommerceCommandContext, input: Json) =>
      Effect.fromResult(decode(input)).pipe(
        Effect.map(value => structuredClone(value)),
        Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)),
      ));
}
interface ServiceCommands<Service> {
  readonly read: <Input>(name: string, prepare: Prepare<Input>, invoke: Invoke<Service, Input>) => GraphReadCommand;
  readonly write: <Input>(name: string, prepare: Prepare<Input>, invoke: Invoke<Service, Input>, project?: Project<Input>) => CommerceCommand;
}

/** Definition-local command construction, not a second service/runtime owner.
 * Preparation owns decoding, refusal and copies; use owns the live service,
 * Promise lifetime and result capture. A write's optional pure result projection
 * runs only after that capture; it cannot discard unvalidated native data.
 * Bind actual methods on that live receiver.
 * Several prepared module profiles can coexist without a global Context. */
export function commerceServiceCommands<Service>(use: PreparedCommerceModule<Service>["use"]): ServiceCommands<Service> {
  const run = <Input>(name: string, prepare: Prepare<Input>, invoke: Invoke<Service, Input>, project?: Project<Input>) =>
    Effect.fn(name)(function* (ctx: CommerceCommandContext, input: Json) {
      const prepared = yield* prepare(ctx, input);
      const result = yield* use(ctx, service => invoke(service, prepared));
      return project === undefined ? result : project(result, prepared);
    });
  return {
    read: (name, prepare, invoke) => defineGraphReadCommand(name, run(name, prepare, invoke)),
    write: (name, prepare, invoke, project) => defineCommerceCommand(name, "write", run(name, prepare, invoke, project)),
  };
}
