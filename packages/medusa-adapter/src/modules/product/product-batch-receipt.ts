import { Effect, Result } from "effect";
import { commerceCommandIdentity, type CommerceCommand, type LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { ProductDeletionIds } from "./commands/deletion";
import { ProductUpdateOutput } from "./product-update-input";
import { projectProductOwnedGraphs } from "./product-update-receipt";
import type { ProductRuntimeMetadata } from "./runtime-metadata";

const decodeDeleted = commerceDecoder(ProductDeletionIds, "receiptMismatch");
const decodeUpdated = commerceDecoder(ProductUpdateOutput, "receiptMismatch");

/** Sparse native preimage results do not identify retained children. The
 * aggregate receipt uses the existing authenticated activity instead. */
export function productBatchInitialVariantReceipt(catalog: ProductRuntimeMetadata,
  updateCommands: readonly CommerceCommand[], deletionCommand: CommerceCommand,
): Result.Result<LogicalCommerceEventValidation, ReturnType<typeof commerceError>> {
  return Result.gen(function* () {
    const updates = new Set<string>();
    for (const command of updateCommands) {
      const identity = commerceCommandIdentity(command);
      if (identity?.mode !== "write") return yield* Result.fail(commerceError("invalidAuthority"));
      updates.add(identity.name);
    }
    const deletion = commerceCommandIdentity(deletionCommand);
    if (deletion?.mode !== "write") return yield* Result.fail(commerceError("invalidAuthority"));
    const validate: LogicalCommerceEventValidation = Effect.fn("ProductBatch.validateInitialVariants")(function* (calls, mutations, _lifecycle, observedRows) {
      const selected = new Set<string>();
      for (const call of calls) {
        if (updates.has(call.commandName)) {
          for (const product of yield* Effect.fromResult(decodeUpdated(call.result))) selected.add(product.id);
        } else if (call.commandName === deletion.name) {
          for (const id of yield* Effect.fromResult(decodeDeleted(call.input))) selected.add(id);
        }
      }
      if (selected.size === 0) return;
      const { previous } = yield* projectProductOwnedGraphs(catalog, { mutations, observedRows });
      const existing = new Set<string>();
      for (const product of previous.get(catalog.product.table.name)?.values() ?? []) {
        if (typeof product.id === "string" && product.deleted_at === null && selected.has(product.id)) existing.add(product.id);
      }
      // Reversing inserts removes sibling-created roots and Variants. Parent
      // membership excludes foreign inverse owners even when observed natively.
      let variants = 0;
      for (const variant of previous.get(catalog.variant.table.name)?.values() ?? []) {
        const parent = variant[catalog.foreignKeys.variant];
        if (variant.deleted_at === null && typeof parent === "string" && existing.has(parent)) variants++;
      }
      if (variants > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
    });
    return validate;
  });
}
