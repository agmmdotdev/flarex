import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { currencyWorkflowModule } from "../src/currency-service";
import { makeLocalProductCommands } from "../src/product-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productModuleEventPolicy } from "../src/product-local-events";
import { prepareProductTagWorkflow } from "../src/product-tag-workflow";
import { prepareProductTagUpdateWorkflow } from "../src/product-tag-update-workflow";
import { prepareProductTagDeleteWorkflow } from "../src/product-tag-delete-workflow";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { dataBindingActivationRequest, makeDataBindingHost, type DataBindingHost } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { commercePhysicalRows } from "../../persistence-postgres/test/commerceInventory";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { logicalCategoryCurrencyFixture } from "./support/logical-category-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = process.env.FLAREX_TEST_DRIVER ?? process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Medusa comparison driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCategoryCurrencyFixture>>;
let physicalBindings: DataBindingHost<unknown>;
let currentBindings: DataBindingHost<unknown>;
let commands: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let policy: ReturnType<typeof productModuleEventPolicy>;
const revision = createHash("sha256").update("logical-product-tag-binding").digest("hex");
const subscribers = [{ id: "logical-tag-binding", revision: "a".repeat(64) }];
const execution = () => ({ identityAndAccessPolicy: fixture.input.identityAndAccessPolicy,
  prepare: (composition: import("../src/workflow/host").AtomicWorkflowHostComposition) =>
    makeAtomicCommerceHost({ ...fixture.input, ...composition }),
});
const productModule = () => ({ module: commands.workflow, profile: fixture.product.profile,
  installation: fixture.installation, moduleEvents: policy });
const rows = () => commercePhysicalRows(fixture.currency.persistence, fixture.product.descriptor.layout.frame);

const activate = Effect.fn("LogicalProductTagBinding.activate")(function* (
  frame: Effect.Success<ReturnType<typeof readAdmittedDataBinding>>["frame"], action: string,
) {
  const current = yield* currentBindings.withCurrent(readAdmittedDataBinding);
  const next = frame.logicalSchema === null ? physicalBindings : fixture.bindings;
  const candidate = yield* next.prepare(frame);
  yield* next.activate(dataBindingActivationRequest(frame.application.scopeId,
    frame.application.storageGeneration, action, candidate.sha256, current.head));
  yield* Effect.sync(() => { currentBindings = next; });
});

const productWorkflow = Effect.fn("LogicalProductTagBinding.productWorkflow")(function* (kind: "update" | "delete", id: string) {
  if (kind === "update") {
    const host = yield* prepareProductTagUpdateWorkflow({ execution: execution(), revision,
      subscribers, modules: { product: productModule() } });
    return { newRequestKey: host.newRequestKey, close: host.close,
      run: (key: string) => host.run(key, { selector: { id }, update: { value: `${id}-updated` } }) };
  }
  const host = yield* prepareProductTagDeleteWorkflow({ execution: execution(), revision,
    subscribers, modules: { product: productModule() } });
  return { newRequestKey: host.newRequestKey, close: host.close,
    run: (key: string) => host.run(key, { ids: [id] }) };
});

describe("Product-only native workflows beside logical Currency", () => {
  beforeAll(async () => {
    fixture = await logicalCategoryCurrencyFixture(driver, close => cleanup.push(close));
    physicalBindings = await runEffect(makeDataBindingHost({ database: fixture.currency.persistence.drizzle,
      target: fixture.currency.bindingTarget, deploymentId: fixture.currency.deploymentId,
      authority: fixture.currency.hostInput.authority, application: fixture.currency.hostInput.application,
      commerceProfiles: [fixture.product.profile] }));
    currentBindings = fixture.bindings;
    commands = await runEffect(makeLocalProductCommands());
    const metadata = await runEffect(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    policy = productModuleEventPolicy(fixture.product.descriptor, metadata);
  }, 150_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical Product binding cleanup failed");
  }, 120_000);

  for (const kind of ["update", "delete"] as const) {
    it(`keeps ${kind} replay bound to the whole Product and Currency selection`, async () => {
      const id = `logical-binding-${kind}`;
      const create = await runEffect(prepareProductTagWorkflow({ execution: execution(), revision,
        subscribers, modules: { product: productModule(),
          currency: { module: Result.getOrThrow(currencyWorkflowModule),
            logicalStorage: fixture.currency.hostInput.logicalStorage } } }));
      try {
        expect(await runEffect(create.run(create.newRequestKey(), { product_tags: [{ id, value: id }] })))
          .toMatchObject([{ id, value: id }]);
      } finally { await runEffect(create.close); }
      const mixed = await runEffect(currentBindings.withCurrent(readAdmittedDataBinding));
      if (mixed.frame.logicalSchema === null) throw new Error("Missing logical Currency selection");
      const sourceRows = await logicalCurrencyInventory(fixture.currency);
      await runEffect(activate({ ...mixed.frame, logicalSchema: null }, `${kind}-product-only`));
      try {
        const host = await runEffect(productWorkflow(kind, id));
        try {
          const key = host.newRequestKey();
          const first = await runEffect(host.run(key));
          if (kind === "update") expect(first).toMatchObject([{ id, value: `${id}-updated` }]);
          else expect(first).toBeNull();
          await runEffect(activate(mixed.frame, `${kind}-restore-logical`));
          const before = { logical: await logicalCurrencyInventory(fixture.currency), product: await rows() };
          expect(await runEffectFailure(host.run(key))).toMatchObject({ reason: "requestConflict" });
          expect({ logical: await logicalCurrencyInventory(fixture.currency), product: await rows() }).toEqual(before);
          expect(await fixture.currency.service.retrieveCurrency("usd")).toMatchObject({ code: "usd" });
          const next = await runEffect(host.run(host.newRequestKey()));
          if (kind === "update") expect(next).toMatchObject([{ id, value: `${id}-updated` }]);
          else expect(next).toBeNull();
          expect((await logicalCurrencyInventory(fixture.currency)).rows).toEqual(sourceRows.rows);
          await runEffect(activate({ ...mixed.frame, commerce: [] }, `${kind}-remove-product`));
          const removed = { logical: await logicalCurrencyInventory(fixture.currency), product: await rows() };
          expect(await runEffectFailure(host.run(host.newRequestKey())))
            .toMatchObject({ reason: "bindingChanged" });
          expect({ logical: await logicalCurrencyInventory(fixture.currency), product: await rows() }).toEqual(removed);
          expect(await fixture.currency.service.retrieveCurrency("usd")).toMatchObject({ code: "usd" });
        } finally { await runEffect(host.close); }
      } finally {
        await runEffect(activate(mixed.frame, `${kind}-final-restore`));
      }
    }, 120_000);
  }
});
