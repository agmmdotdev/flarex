import { Effect, Result, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import type { LogicalCommerceSelectionInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/logicalSelection";
import { captureShippingProfileDeletionMetadata } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingProfileDeletionContracts } from "../../src/modules/fulfillment/shipping-profile-delete-input";
import { projectNativeRow } from "../../src/repository/result";
import { compileCompleteRow } from "../../src/value/complete-row";
import { commerceDecoder } from "../../src/value/decoder";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

/** Canonical fixture mutation for a storage-isolation proof. This deliberately
 * bypasses native ShippingOption/provider behavior and proves none of that API.
 * It uses the actual six-table source and optimistic atomic settlement owner. */
export async function prepareShippingProfileOptionRaceFixture(options: Readonly<{
  fixture: LogicalCurrencyFixture;
  logicalStorage: LogicalCommerceSelectionInput;
  afterStaged: Effect.Effect<void>;
  operation?: "insert" | "restore";
  close: (cleanup: () => Promise<void>) => void;
}>) {
  const metadata = await Effect.runPromise(captureShippingProfileDeletionMetadata());
  const contracts = Result.getOrThrow(compileShippingProfileDeletionContracts(metadata.frame));
  const rowDecoders = new Map(metadata.frame.tables.map(table => [table.name, Result.getOrThrow(compileCompleteRow(table))]));
  const decodeOutput = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 1)), "receiptMismatch");
  const operation = options.operation ?? "insert";
  const commandName = operation === "insert" ? "shippingOptionRaceFixtureInsert" : "shippingOptionRaceFixtureRestore";
  const insert = defineCommerceCommand(commandName, "write", Effect.fn(function* (ctx, input) {
    const row = yield* Effect.fromResult(contracts.decodeOptionRow(input));
    const table = yield* ctx.table(contracts.option.name);
    if (operation === "restore") return [...yield* table.lifecycle(ctx.manager, "restore", [{ id: row.id }])];
    if (row.deleted_at !== null) return yield* ctx.refuse(commerceError("invalidInput"));
    return [...yield* table.write(ctx.manager, "insert", [row])];
  }));
  const participant = defineAtomicCommerceParticipant("shippingOptionRaceFixture");
  const root = defineAtomicCommerceCommand("shippingOptionRaceFixtureRoot", (ctx, input) => Effect.gen(function* () {
    const output = yield* ctx.call(participant, insert, input);
    yield* options.afterStaged;
    return output;
  }));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...options.fixture.hostInput,
    identityAndAccessPolicy: { profile: "shipping-option-canonical-race-fixture" }, commands: [root],
    participants: [{ participant, logicalStorage: options.logicalStorage, commands: [insert],
      validateLogicalCall: Effect.fn(function* (call, activity, command) {
        if (command !== insert || call.commandName !== commandName || call.mode !== "write" ||
          call.events.length || activity.mutations.length !== 1 || activity.lifecycle.length !== (operation === "restore" ? 1 : 0) || activity.setNull.length || activity.referenceReplacements.length)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const supplied = yield* Effect.fromResult(contracts.decodeOptionRow(call.input));
        const output = yield* Effect.fromResult(decodeOutput(call.result));
        const row = output[0], mutation = activity.mutations[0];
        if (row === undefined || mutation === undefined || mutation.ordinal !== 0 || mutation.table !== contracts.option.name ||
          mutation.operation !== (operation === "insert" ? "insert" : "patch") || mutation.after === null ||
          !jsonEqual(row, projectNativeRow(mutation.after)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (operation === "insert") {
          if (mutation.before !== null || !jsonEqual(supplied, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
        } else {
          const lifecycle = activity.lifecycle[0];
          if (mutation.before === null || lifecycle === undefined || lifecycle.operation !== "restore" || lifecycle.table !== contracts.option.name ||
            !jsonEqual(projectNativeRow(mutation.before), supplied) || !jsonEqual(lifecycle.key, { id: supplied.id }) ||
            lifecycle.beforeDeletedAt !== supplied.deleted_at || lifecycle.afterDeletedAt !== null || lifecycle.attemptOrdinal !== 0 ||
            row.id !== supplied.id || row.deleted_at !== null)
            return yield* Effect.fail(commerceError("receiptMismatch"));
        }
        for (const observation of activity.observedRows) {
          const decode = rowDecoders.get(observation.table);
          if (decode === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
          yield* Effect.fromResult(decode(projectNativeRow(observation.row)));
        }
      }),
    }],
  }));
  options.close(() => Effect.runPromise(host.close));
  return { newRequestKey: host.newRequestKey,
    run: (key: string, row: JsonObject) => host.run(key, root, row) };
}
