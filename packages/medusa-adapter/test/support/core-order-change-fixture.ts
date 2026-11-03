import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { REQUESTS } from "../../../persistence-postgres/src/core/registry";
import type { CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileOrderCoreDefinition } from "../../src/modules/order/schema";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import type { OrderInitialRow } from "./order-change-rows";

const readStoredBody = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ json_value: Schema.Uint8Array })));
const decoder = new TextDecoder();

/** Replace only the encoded result in the exact committed root record. Fresh
 * owner generations ensure the real DTO decoder sees the corrupt durable value. */
async function withStoredOrderResult(fixture: CoreNativeWorkflowFixture, key: string, value: Json, work: () => Promise<void>) {
  const { physical } = fixture;
  const matching = (await fixture.inventory()).outcomes.filter(record => record.value.key === key &&
    record.value.kind === "nativeRoot" && record.value.state === "committed");
  const [record] = matching;
  if (matching.length !== 1 || record === undefined || typeof record.value.result !== "string") {
    throw new Error("Missing exact committed Order Change result");
  }
  const id = Result.getOrThrow(decodeDocumentId(record.value._id));
  const registry = await Effect.runPromise(readCoreFixtureRegistry(physical, record.timestamp));
  const table = [...registry.tables.values()].find(({ definition }) => definition.name === REQUESTS)?.definition;
  if (table === undefined || table.number !== id.tableNumber) throw new Error("Order Change result has the wrong stored table identity");
  const selector = [physical.instanceName, table.tabletId, id.internalId, record.timestamp.toString()] as const;
  const where = "instance_name=$1 AND table_id=$2 AND id=$3 AND ts=$4";
  const [stored] = readStoredBody(await physical.query(`SELECT json_value FROM "${physical.namespace}".documents WHERE ${where}`, selector));
  if (stored === undefined) throw new Error("Missing stored Order Change result body");
  const replacement = Result.getOrThrow(encodeDocumentValue({ ...record.value,
    result: decoder.decode(Result.getOrThrow(encodeDocumentValue(value))) }));
  const replace = async (expected: Uint8Array, body: Uint8Array) => {
    const changed = await physical.query(`UPDATE "${physical.namespace}".documents SET json_value=$5
      WHERE ${where} AND json_value=$6 RETURNING id`, [...selector, body, expected]);
    if (changed.length !== 1) throw new Error("Exact Order Change result body changed before fixture replacement");
  };
  const closeGeneration = async () => {
    const database = await fixture.run(fixture.useGeneration(generation => Effect.succeed(generation.database)));
    await fixture.run(database.close());
    return database;
  };
  const recover = async (previous: Awaited<ReturnType<typeof closeGeneration>>) => {
    await fixture.run(fixture.recover);
    const current = await fixture.run(fixture.useGeneration(generation => Effect.succeed(generation.database)));
    if (current === previous) throw new Error("Order Change replay requires a fresh Core generation");
  };
  const prior = await closeGeneration();
  await replace(stored.json_value, replacement);
  const failures: unknown[] = [];
  try {
    await recover(prior);
    await work();
  } catch (failure) {
    failures.push(failure);
  }
  let damaged: Awaited<ReturnType<typeof closeGeneration>> | undefined;
  try {
    damaged = await closeGeneration();
  } catch (failure) {
    failures.push(failure);
  }
  try {
    await replace(replacement, stored.json_value);
    // Reopen only after the damaged generation's close is confirmed.
    if (damaged !== undefined) await recover(damaged);
  } catch (failure) {
    failures.push(failure);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Order Change replay and cleanup failures");
}

export async function prepareCoreOrderChangeFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  commands: readonly CommerceCommand[], rows: readonly OrderInitialRow[], physical?: CorePersistenceFixture) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const definition = await Effect.runPromise(compileOrderCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const fixture = await createCoreNativeWorkflowFixture(driver, {
    eventDefinition, sources: [{ name: "order", definition, initialCommands: commands, rows }],
    ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }),
  });
  close(fixture.close);
  const orderIds = rows.filter(value => value.table === "order").map(value => {
    if (typeof value.row.id !== "string") throw new Error("Missing native Order seed ID");
    return value.row.id;
  });
  return { fixture, definition, source: fixture.source("order"), execution: fixture.execution, snapshot: fixture.snapshot,
    read: (ids: readonly string[] = orderIds) => fixture.readRows("order", ids),
    withStoredOrderResult: (key: string, value: Json, work: () => Promise<void>) => withStoredOrderResult(fixture, key, value, work) };
}
