import { Cause, Effect, Exit, Result } from "effect";
import { expect, it } from "vitest";
import { defineAtomicCommerceNativeSource } from "@flarex/persistence-postgres/internal/commerce-native";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { checkoutRuntimes, customerCheckoutRuntimes } from "./support/core-checkout-fixture";
import { checkoutCoreDefinitions } from "./support/checkout-core-definitions";
import { captureInstalledWorkflowModules, type AtomicWorkflowExecution } from "../src/workflow/host";
import { prepareCompleteCartWorkflow, prepareCustomerCompleteCartWorkflow } from "../src/workflows/cart/complete-cart";
import { checkoutModuleNames, customerCheckoutModuleNames } from "../src/workflows/cart/checkout-graph";
import type { WorkflowModule } from "../src/workflow/module";

it.each([false, true])("prepares the supported digital checkout identity before storage admission (customer=%s)", async customer => {
  const runtime = await (customer ? customerCheckoutRuntimes() : checkoutRuntimes());
  const workflows: Readonly<Record<string, WorkflowModule>> = runtime.workflows;
  const definitions = await Effect.runPromise(checkoutCoreDefinitions({ scopeUuid: "de000000-0000-4000-8000-000000000001",
    epochUuid: "de000000-0000-4000-8000-000000000002" }, customer));
  const entries = [];
  for (const [name, definition] of Object.entries(definitions)) {
    const module = workflows[name];
    if (module === undefined) throw new Error("Missing genuine checkout module");
    entries.push([name, { module, nativeStorage: Result.getOrThrow(defineAtomicCommerceNativeSource(name, definition)) }]);
  }
  const reached = commerceError("resourceFailure", "reached trusted host preparation");
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: {}, prepare: () => Effect.fail(reached) };
  const options = { execution, logger: runtime.payment.loggerResource, link: runtime.link, revision: "a".repeat(64), subscribers: [] };
  const exit = await Effect.runPromiseExit(customer ? prepareCustomerCompleteCartWorkflow({ ...options,
    modules: Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(entries), customerCheckoutModuleNames)) })
    : prepareCompleteCartWorkflow({ ...options,
      modules: Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(entries), checkoutModuleNames)) }));
  if (Exit.isSuccess(exit)) throw new Error("Construction proof supplied no execution host");
  expect(exit.cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error] : []), Cause.pretty(exit.cause)).toContain(reached);
}, 60_000);
