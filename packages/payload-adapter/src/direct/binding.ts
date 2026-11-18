import { Effect } from "effect";
import { cmsError, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { bindCmsCommand, bindCmsRead, type CmsCommandBinding, type CmsReadBinding, type CmsHost, type CmsReadHost } from
  "@flarex/persistence-postgres/internal/cms-execution";
import { bindCmsNativeCommand, bindCmsNativeRead, type CmsNativeBinding } from "@flarex/persistence-postgres/internal/cms-execution";
import type { PayloadHost, PayloadReadHost } from "../api";
import { payloadCanonicalResults } from "../results";
import type { PayloadNative } from "../runtime/native";
import { registerPayloadHost } from "../runtime/registry";

/** Both storage profiles use the same native instance and result translation. */
export function bindPayloadDirect(native: PayloadNative) {
  const { commands, retainHost } = native;
  const live = <A>(work: Effect.Effect<A, CmsTransactionError>) =>
    Effect.suspend(() => native.isLive() ? work : Effect.fail(cmsError("closed")));
  const readMethods = (execution: CmsReadHost) => ({
    requestBudget: execution.requestBudget, close: execution.close,
    find: (args: Parameters<PayloadReadHost["find"]>[0]) => live(execution.read(commands.find, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.page(value)))),
    findByID: (args: Parameters<PayloadReadHost["findByID"]>[0]) => live(execution.read(commands.findByID, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
    count: (args: Parameters<PayloadReadHost["count"]>[0]) => live(execution.read(commands.count, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.count(value)))),
  });
  const writeHost = (execution: CmsHost): PayloadHost => {
    const host = Object.freeze<PayloadHost>({ ...readMethods(execution), newRequestKey: execution.newRequestKey,
      create: (key, args) => live(execution.run(key, commands.create, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
      update: (key, args) => live(execution.run(key, commands.update, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
      delete: (key, args) => live(execution.run(key, commands.delete, args)).pipe(Effect.flatMap(value => Effect.fromResult(payloadCanonicalResults.document(value)))),
    });
    registerPayloadHost(host, execution, native);
    return host;
  };
  const readHost = (execution: CmsReadHost): PayloadReadHost => {
    const host = Object.freeze<PayloadReadHost>(readMethods(execution));
    registerPayloadHost(host, execution, native);
    return host;
  };
  // Full-proof, relationship and borrowed consumers retain their selected owner.
  const bind = Effect.fn("PayloadAdapter.bind")(function* (binding: CmsCommandBinding) {
    return writeHost(yield* retainHost(bindCmsCommand(binding, Object.values(commands), native.contentIdentity)));
  });
  const reads = [commands.find, commands.findByID, commands.count];
  const bindRead = Effect.fn("PayloadAdapter.bindRead")(function* (binding: CmsReadBinding) {
    return readHost(yield* retainHost(bindCmsRead(binding, reads, native.contentIdentity)));
  });
  const bindNative = Effect.fn("PayloadAdapter.bindNative")(function* (binding: CmsNativeBinding) {
    return writeHost(yield* retainHost(bindCmsNativeCommand(binding, Object.values(commands), native.contentIdentity)));
  });
  const bindNativeRead = Effect.fn("PayloadAdapter.bindNativeRead")(function* (binding: CmsNativeBinding) {
    return readHost(yield* retainHost(bindCmsNativeRead(binding, reads, native.contentIdentity)));
  });
  return { bind, bindRead, bindNative, bindNativeRead };
}
