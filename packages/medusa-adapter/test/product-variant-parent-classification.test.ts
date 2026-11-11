import { beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { runCommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productMutationCommands } from "../src/modules/product/commands/mutations";

let metadata: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
beforeAll(async () => {
  metadata = await Effect.runPromise(captureProductSchema("variant-parent-classification")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

async function fixture(tombstone = false, defect?: Error) {
  const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(commerceError,
    { ...defaultCommerceResources, commandMs: 30_000 }, {}, {}, "variant-parent-classification", "write"));
  const reads: unknown[] = [];
  const unexpected = () => Effect.die(new Error("Unexpected native Product service or store mutation"));
  const commands = productMutationCommands({ metadata, withService: unexpected, withCollectionService: unexpected });
  const store: CommerceCommandContext["store"] = {
    prepareRead: () => ({ find: unexpected, findPage: unexpected, count: unexpected }),
    find: (_manager, query) => defect === undefined ? Effect.sync(() => {
      reads.push(query);
      return [{ id: "variant-foreign", product_id: "product-other", deleted_at: tombstone ? "2026-11-10T00:00:00.000Z" : null }];
    }) : Effect.die(defect),
    findPage: unexpected, count: unexpected, aggregate: unexpected, write: unexpected, delete: unexpected, lifecycle: unexpected,
  };
  const context: CommerceCommandContext = {
    resources: defaultCommerceResources, manager: lifetime.context, store,
    table: name => name === metadata.variant.table.name ? Effect.succeed(store) : unexpected(),
    captureLocalEvent: unexpected, nested: unexpected, rejectEvent: unexpected(),
    recordFailure: cause => lifetime.recordFailure(lifetime.context, cause),
    refuse: error => Effect.fail(error).pipe(Effect.onError(cause => Effect.sync(() =>
      Result.getOrThrow(lifetime.recordFailure(lifetime.context, cause))))),
    borrow: work => work(context),
  };
  return { lifetime, reads, run: (input: Parameters<typeof runCommerceCommand>[2]) =>
    Effect.runPromiseExit(runCommerceCommand(commands.upsertVariants, context, input)) };
}

describe("Product-owned Variant parent refusal classification", () => {
  it.each([false, true])("classifies an explicit foreign parent as native INVALID_DATA, tombstone=%s", async tombstone => {
    const tested = await fixture(tombstone);
    try {
      const exit = await tested.run([{ id: "variant-foreign", product_id: "product-route", title: "Never changed" }]);
      if (Exit.isSuccess(exit)) throw new Error("Foreign Variant parent was accepted");
      expect(exit.cause.reasons).toHaveLength(1);
      const reason = exit.cause.reasons[0];
      if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected typed Product refusal");
      expect(reason.error.reason).toBe("adapterFailure");
      expect(reason.error.cause).toBeInstanceOf(MedusaError);
      expect(reason.error.cause).toMatchObject({ type: MedusaError.Types.INVALID_DATA,
        message: "Cannot update variants outside the specified Product" });
      expect(tested.reads).toEqual([{ take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: ["variant-foreign"] } }]);
      // The original classified failure remains sticky in the genuine request
      // lifetime and is accompanied by its separate rollback marker.
      const sealed = await Effect.runPromiseExit(tested.lifetime.seal);
      if (Exit.isSuccess(sealed)) throw new Error("Refused request was allowed to settle");
      expect(sealed.cause.reasons.filter(Cause.isFailReason).map(item => item.error.reason)).toEqual(["rollbackOnly", "adapterFailure"]);
    } finally { await Effect.runPromise(tested.lifetime.close); }
  });

  it("leaves malformed data in its existing validation channel", async () => {
    const tested = await fixture();
    try {
      const exit = await tested.run([{ id: 42, product_id: "product-route" }]);
      if (Exit.isSuccess(exit)) throw new Error("Malformed Variant was accepted");
      expect(exit.cause.reasons.every(reason => Cause.isFailReason(reason) && reason.error.reason !== "adapterFailure")).toBe(true);
      expect(tested.reads).toEqual([]);
    } finally { await Effect.runPromise(tested.lifetime.close); }
  });

  it("preserves an unexpected store defect without native business presentation", async () => {
    const defect = new Error("Unexpected row port defect"), tested = await fixture(false, defect);
    try {
      const exit = await tested.run([{ id: "variant-foreign", product_id: "product-route" }]);
      if (Exit.isSuccess(exit)) throw new Error("Defective read was accepted");
      expect(exit.cause.reasons).toHaveLength(1);
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isDieReason(reason) ? reason.defect : undefined).toBe(defect);
    } finally { await Effect.runPromise(tested.lifetime.close); }
  });
});
