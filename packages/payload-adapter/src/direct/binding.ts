import { Effect } from "effect";
import { cmsError, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { bindCmsCommand, bindCmsRead, type CmsCommandBinding, type CmsReadBinding } from
  "@flarex/persistence-postgres/internal/cms-execution";
import type { PayloadHost, PayloadReadHost } from "../api";
import { payloadCanonicalResults } from "../results";
import type { PayloadNative } from "../runtime/native";
import { registerPayloadHost } from "../runtime/registry";

/** Direct operations share the exact native instance and retained CMS host. */
export function bindPayloadDirect(native: PayloadNative) {
  const { commands, retainHost } = native;
  const live = <A>(work: Effect.Effect<A, CmsTransactionError>) =>
    Effect.suspend(() => native.isLive() ? work : Effect.fail(cmsError("closed")));
  const bind = Effect.fn("PayloadAdapter.bind")(function* (binding: CmsCommandBinding): Effect.fn.Return<PayloadHost, CmsTransactionError> {
    const execution = yield* retainHost(bindCmsCommand(binding, Object.values(commands), native.contentIdentity));
    const host = Object.freeze<PayloadHost>({
      requestBudget: execution.requestBudget, close: execution.close, newRequestKey: execution.newRequestKey,
      create: (key, args) => live(execution.run(key, commands.create, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
      update: (key, args) => live(execution.run(key, commands.update, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
      delete: (key, args) => live(execution.run(key, commands.delete, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
      find: args => live(execution.read(commands.find, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.page(value)))),
      findByID: args => live(execution.read(commands.findByID, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
      count: args => live(execution.read(commands.count, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.count(value)))),
    });
    registerPayloadHost(host, execution, native);
    return host;
  });
  const bindRead = Effect.fn("PayloadAdapter.bindRead")(function* (binding: CmsReadBinding): Effect.fn.Return<PayloadReadHost, CmsTransactionError> {
    const execution = yield* retainHost(bindCmsRead(binding, [commands.find, commands.findByID, commands.count], native.contentIdentity));
    const host = Object.freeze<PayloadReadHost>({
      requestBudget: execution.requestBudget, close: execution.close,
      find: args => live(execution.read(commands.find, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.page(value)))),
      findByID: args => live(execution.read(commands.findByID, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
      count: args => live(execution.read(commands.count, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.count(value)))),
    });
    registerPayloadHost(host, execution, native);
    return host;
  });
  return { bind, bindRead };
}
