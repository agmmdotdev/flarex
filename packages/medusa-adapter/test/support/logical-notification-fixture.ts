import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { compileNotificationDefinition } from "../../src/modules/notification/schema";
import { makeLocalNotificationCommands } from "../../src/modules/notification/service";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";

interface LogicalNotificationFixture {
  readonly fixture: LogicalCurrencyFixture;
  readonly definition: Effect.Success<ReturnType<typeof compileNotificationDefinition>>;
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalNotificationCommands>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
}

/** Source preparation precedes the one complete configured candidate. */
export async function notificationLogicalSource() {
  const definition = await Effect.runPromise(compileNotificationDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.notification", owner: "medusa",
    writeProfile: "medusa.notification", evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  return { definition, source };
}

/** Bind the same genuine Notification profile beside an existing configured
 * Product graph. This performs no second schema installation. */
export async function prepareLogicalNotificationHost(fixture: LogicalCurrencyFixture,
  { definition, source }: Awaited<ReturnType<typeof notificationLogicalSource>>, logger: Logger): Promise<LogicalNotificationFixture> {
  const runtime = await Effect.runPromise(makeLocalNotificationCommands(logger));
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => new Error("Invalid Notification seed"), hashFailure: cause => new Error("Notification seed hash", { cause }) }));
  const hostInput = { ...fixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-notification-phases-test" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "notification-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    }, commands: runtime.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializing = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializing.initialize([])); }
  finally { await Effect.runPromise(initializing.close); }
  return { fixture, definition, runtime, hostInput };
}

/** Fresh logical schema enrollment, not a migration of a named installation. */
export async function logicalNotificationFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void, logger: Logger): Promise<LogicalNotificationFixture> {
  const prepared = await notificationLogicalSource();
  const fixture = await logicalCurrencyFixture(driver, close, { additionalSources: [prepared.source] });
  return prepareLogicalNotificationHost(fixture, prepared, logger);
}
