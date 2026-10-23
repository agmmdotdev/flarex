import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { canonicalizeJsonOutcome } from "../../../persistence-postgres/src/values/jsonOutcome";
import { fxSystemIdempotency } from "../../../persistence-postgres/src/database/schema";
import { compileOrderDefinition } from "../../src/modules/order/schema";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

export type OrderInitialRow = Readonly<{ table: string; row: JsonObject }>;
export type OrderFixtureShared = Readonly<{ resource: LogicalCurrencyFixture["resource"];
  fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>;

/** Shared Order model install, initialization and inventory mechanics only. */
export async function prepareLogicalOrderFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  commands: LogicalCommerceHostInput<unknown>["commands"], profile: string, rows: readonly OrderInitialRow[], shared?: OrderFixtureShared,
  serialDefaults: "preserve" | "generate" = "preserve") {
  const definition = await Effect.runPromise(compileOrderDefinition(serialDefaults));
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.order", owner: "medusa", writeProfile: "medusa.order",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) }));
  const configuration = { additionalSources: [source] };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows },
    1_048_576, { invalidInput: () => new Error("Invalid existing Order seed"), hashFailure: cause => new Error("Order seed hash", { cause }) }));
  const input = { ...fixture.hostInput, commands, identityAndAccessPolicy: { profile: "logical-" + profile + "-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: profile + "-existing-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(rows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const snapshot = () => logicalCurrencyInventory(fixture);
  const rootIds = new Set(rows.filter(value => value.table === "order").map(value => value.row.id));
  const read = async (selected?: readonly string[]) => {
    const inventory = await snapshot(), output: JsonObject[] = [];
    const scopeUuid = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const row of inventory.rows) {
      if (row.scopeUuid !== scopeUuid) continue;
      const version = inventory.revisions.find(value => value.scopeUuid === row.scopeUuid && value.tableId === row.tableId &&
        value.commitSeq === row.commitSeq && Buffer.from(value.rowId).equals(Buffer.from(row.rowId)));
      if (version === undefined || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const value = projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson));
      if (typeof value.id === "string" && (selected === undefined ? rootIds.has(value.id) : selected.includes(value.id))) output.push(value);
    }
    return output.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  /** Fault only one genuine committed JSON result using its canonical owner.
   * Request identity, commit linkage, rows and events remain untouched. Restore
   * the original evidence even when the replay assertion fails. */
  const withStoredOrderResult = async (key: string, value: unknown, work: () => Promise<void>) => {
    const db = fixture.persistence.drizzle, scopeUuid = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    const requestKey = Schema.decodeUnknownSync(TransactionRequestKeyV1Schema)(key);
    const match = and(eq(fxSystemIdempotency.scopeUuid, scopeUuid), eq(fxSystemIdempotency.requestKey, requestKey));
    const [original] = await db.select().from(fxSystemIdempotency).where(match);
    if (original?.resultState !== "available" || original.resultEncoding !== "json" || original.resultBytes === null
      || original.resultSha256 === null || original.resultSemanticBytes === null) throw new Error("Missing genuine committed Order JSON result");
    const canonical = Result.getOrThrow(canonicalizeJsonOutcome(value)), bytes = canonical.canonicalBytes;
    await db.update(fxSystemIdempotency).set({ resultBytes: bytes, resultSha256: createHash("sha256").update(bytes).digest(),
      resultSemanticBytes: canonical.semanticSizeBytes }).where(match);
    try { await work(); }
    finally { await db.update(fxSystemIdempotency).set({ resultBytes: original.resultBytes,
      resultSha256: original.resultSha256, resultSemanticBytes: original.resultSemanticBytes }).where(match); }
  };
  return { fixture, definition, logicalStorage: input.logicalStorage, execution, snapshot, read, withStoredOrderResult };
}
