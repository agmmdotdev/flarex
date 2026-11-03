import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { REQUESTS } from "../../../persistence-postgres/src/core/registry";
import type { CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileOrderCoreDefinition } from "../../src/modules/order/schema";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowFixture,
  type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

export type CoreOrderInitialRow = CoreNativeWorkflowSource["rows"][number];

export async function finishOrderFixture(steps: readonly (() => Promise<void>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Order fixture steps failed");
}

export function orderFixtureExit<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause), { cause: exit.cause });
  return exit.value;
}

export function orderFixtureHosts(close: (cleanup: () => Promise<void>) => void) {
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H): H => {
    hosts.push(async () => orderFixtureExit(await Effect.runPromiseExit(host.close)));
    return host;
  };
  const closeCaseHosts = () => finishOrderFixture(hosts.splice(0).reverse());
  close(closeCaseHosts);
  return { own, closeCaseHosts };
}

const decodeStoredBody = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ json_value: Schema.Uint8Array })]));
export const readStoredOrderResultBytes = (rows: unknown): Uint8Array => decodeStoredBody(rows)[0].json_value;
const decoder = new TextDecoder();

/** Replace only the encoded result in the exact committed root record. Fresh
 * owner generations ensure the real DTO decoder sees the corrupt durable value. */
async function withStoredOrderResult(fixture: CoreNativeWorkflowFixture, key: string, value: Json, work: () => Promise<void>) {
  const { physical } = fixture;
  const matching = (await fixture.inventory()).outcomes.filter(record => record.value.key === key &&
    record.value.kind === "nativeRoot" && record.value.state === "committed");
  const [record] = matching;
  if (matching.length !== 1 || record === undefined || typeof record.value.result !== "string") {
    throw new Error("Missing exact committed Order result");
  }
  const id = Result.getOrThrow(decodeDocumentId(record.value._id));
  const registry = await Effect.runPromise(readCoreFixtureRegistry(physical, record.timestamp));
  const table = [...registry.tables.values()].find(({ definition }) => definition.name === REQUESTS)?.definition;
  if (table === undefined || table.number !== id.tableNumber) throw new Error("Order result has the wrong stored table identity");
  const selector = [physical.instanceName, table.tabletId, id.internalId, record.timestamp.toString()] as const;
  const where = "instance_name=$1 AND table_id=$2 AND id=$3 AND ts=$4";
  const readBody = async () => readStoredOrderResultBytes(
    await physical.query(`SELECT json_value FROM "${physical.namespace}".documents WHERE ${where}`, selector));
  const original = await readBody();
  const replacement = Result.getOrThrow(encodeDocumentValue({ ...record.value,
    result: decoder.decode(Result.getOrThrow(encodeDocumentValue(value))) }));
  const replace = async (expected: Uint8Array, body: Uint8Array) => {
    const changed = await physical.query(`UPDATE "${physical.namespace}".documents SET json_value=$5
      WHERE ${where} AND json_value=$6 RETURNING id`, [...selector, body, expected]);
    if (changed.length !== 1) throw new Error("Exact Order result body changed before fixture replacement");
  };
  const run = async <A, E>(work: Effect.Effect<A, E>) => orderFixtureExit(await fixture.run(Effect.exit(work)));
  const generation = fixture.useGeneration(({ database }) => Effect.succeed(database));
  // Close after the owner's invocation has released the open database.
  const prior = await run(generation.pipe(Effect.tap(database => database.close())));
  const reopen = (previous: typeof prior, remember?: (database: typeof prior) => void) =>
    run(fixture.useGeneration(({ database }) => Effect.sync(() => {
      if (database === previous) throw new Error("Order replay requires a fresh Core generation");
      remember?.(database);
    })));
  let closedGeneration: typeof prior | undefined = prior;
  let damagedGeneration: typeof prior | undefined;
  await finishOrderFixture([
    async () => {
      await replace(original, replacement);
      closedGeneration = undefined;
      // Keep the exact handle if the owner reports a failure after the callback.
      await reopen(prior, database => { damagedGeneration = database; });
      await work();
    },
    async () => {
      if (damagedGeneration === undefined) return;
      await run(damagedGeneration.close());
      closedGeneration = damagedGeneration;
    },
    async () => {
      // A rejected initial CAS may have written the replacement before losing its acknowledgement.
      const body = await readBody();
      if (!bytesEqual(body, original)) {
        if (!bytesEqual(body, replacement)) throw new Error("Order result body changed outside fixture replacement");
        await replace(replacement, original);
      }
      if (closedGeneration !== undefined) await reopen(closedGeneration);
    },
  ]);
}

export async function prepareCoreOrderFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  commands: readonly CommerceCommand[], rows: readonly CoreOrderInitialRow[], physical?: CorePersistenceFixture) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const [definition, eventDefinition] = await Effect.runPromise(Effect.all([
    compileOrderCoreDefinition(target),
    compileCoreNativeEventStorageDefinition(target),
  ]));
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
