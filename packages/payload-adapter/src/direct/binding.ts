import { Effect } from "effect";
import { cmsError, makeCmsHost, makeCmsReadHost, type CmsHost, type CmsReadHost, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { PayloadHostInput, PayloadReadHostInput } from "../runtime";
import type { PayloadNative } from "../runtime/native";

/** Direct command hosts share the native instance and its exact Scope. */
export function bindPayloadDirect(native: PayloadNative) {
  const { commands, retainHost } = native;
  const bind = Effect.fn("PayloadAdapter.bind")(function* <Failure>(input: PayloadHostInput<Failure>): Effect.fn.Return<CmsHost, CmsTransactionError> {
    const host = yield* retainHost(Effect.suspend(() => makeCmsHost({ ...input,
      commands: Object.values(commands), expectedContentIdentity: native.contentIdentity })));
    return {
      requestBudget: host.requestBudget,
      close: host.close,
      newRequestKey: host.newRequestKey,
      run: (key, command, args) => Effect.suspend(() => native.isLive() ? host.run(key, command, args) : Effect.fail(cmsError("closed"))),
      read: (command, args) => Effect.suspend(() => native.isLive() ? host.read(command, args) : Effect.fail(cmsError("closed"))),
    };
  });
  const bindRead = Effect.fn("PayloadAdapter.bindRead")(function* <Failure>(input: PayloadReadHostInput<Failure>): Effect.fn.Return<CmsReadHost, CmsTransactionError> {
    const host = yield* retainHost(Effect.suspend(() => makeCmsReadHost({ ...input,
      commands: [commands.find, commands.findByID, commands.count], expectedContentIdentity: native.contentIdentity })));
    return {
      requestBudget: host.requestBudget,
      close: host.close,
      read: (command, args) => Effect.suspend(() => native.isLive() ? host.read(command, args) : Effect.fail(cmsError("closed"))),
    };
  });
  return { bind, bindRead };
}
