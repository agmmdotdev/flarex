import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import { prepareLogicalApplicationSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/applicationAdmission";
import { prepareLogicalDocumentSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/documentAdmission";
import { defineCmsCommand } from "../../persistence-postgres/src/cmsTransaction/host";
import { makeCurrencyAnnouncementHost } from "../../persistence-postgres/src/crossDomainCommand/host";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { currencyAnnouncementWrite } from "../src/currency-service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { readLogicalStorageRequirements } from "../../persistence-postgres/src/logicalStorageDefinitions";
import { requireStrongReferencePublication } from "../../persistence-postgres/src/commitPublication/strongReferenceAdmission";
import { readBindingHeadProjection } from "../../persistence-postgres/src/frameworkSchema/binding/repository";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { logicalTableKey, type QualifiedLogicalTable } from "flarex-protocol/internal/logical-schema-candidate";
import { projectScopeEpochUuidV1, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { prepareNativeApplicationJournalOnLogicalScope } from "../../persistence-postgres/test/nativeApplicationJournalOnLogicalScope";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid cross-source admission driver");
const cleanup: Array<() => Promise<void>> = [];
const payloadCollections = [{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }] as const;
const product = { namespace: "medusa", logicalName: "commerce.product/product" } as const;
const extensions = [{ name: "user_product", sourceKey: "application",
  source: { table: { namespace: "app", logicalName: "users" }, field: "name" },
  target: { table: product, field: "id" }, policy: "strongReference", onTargetDelete: "restrict" },
{ name: "news_product", sourceKey: "payload",
  source: { table: { namespace: "app", logicalName: "news" }, field: "title" },
  target: { table: product, field: "id" }, policy: "strongReference", onTargetDelete: "restrict" }] as const;

describe("cross-source relationship admission stays closed until enforcement exists", () => {
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, payloadCollections, extensions,
    });
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("refuses every affected source but serves unrelated native Currency", async () => {
    const ports = { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts };
    const input = { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
      schemaVersionId: fixture.schemaVersionId };
    await expect(prepareLogicalProductHost(fixture)).rejects.toMatchObject({ reason: "unsupportedProfile" });
    expect(await Effect.runPromise(Effect.flip(prepareLogicalApplicationSourceAdmission(ports,
      fixture.application.uniqueConstraintEligibility, input, fixture.applicationSource))))
      .toMatchObject({ reason: "unsupportedProfile" });
    const payload = await Effect.runPromise(compilePayloadCollections(payloadCollections));
    expect(await Effect.runPromise(Effect.flip(prepareLogicalDocumentSourceAdmission(ports,
      fixture.application.uniqueConstraintEligibility, input, payload.sourceContract))))
      .toMatchObject({ reason: "unsupportedProfile" });
    const compositeFailure = await Effect.runPromise(Effect.flip(makeCurrencyAnnouncementHost({
      hostRuntime: preparedHostTestRuntime(fixture.persistence.drizzle),
      database: fixture.persistence.drizzle, controlDatabase: fixture.control.drizzle,
      session: fixture.session, deploymentId: fixture.deploymentId,
      authority: fixture.application.authorityPorts, application: fixture.application.activation,
      identityAndAccessPolicy: { profile: "cross-source-admission" }, materialization: {},
      expectedContentIdentity: payload.contentIdentity, currency: fixture.hostInput.logicalStorage,
      applicationSource: fixture.applicationSource, payloadSource: payload.sourceContract,
      currencyCommand: currencyAnnouncementWrite,
      cmsCommand: defineCmsCommand({ name: "payload-create", mode: "write", run: () => Effect.succeed(null) }),
      applicationTable: "users",
    })));
    expect(compositeFailure).toMatchObject({ reason: "unsupportedProfile" });
    const value = { code: "csr", name: "Unrelated Currency", symbol: "C", symbol_native: "C" };
    expect(await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, value)))
      .toMatchObject({ code: value.code, name: value.name });
  }, 120_000);

  it("records endpoint membership and checks actual unaffected Currency publication facts", async () => {
    const value = { code: "gate", name: "Streamed Currency Gate", symbol: "G", symbol_native: "G" };
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, value));
    const requirements = await Effect.runPromise(readLogicalStorageRequirements(fixture.control.drizzle,
      fixture.deploymentId, fixture.schemaVersionId));
    const tableId = (table: QualifiedLogicalTable) => {
      const binding = requirements.evidence.tableBindings.find(member =>
        logicalTableKey(member.table) === logicalTableKey(table));
      if (binding === undefined) throw new Error("Missing bound logical table");
      return binding.tableId;
    };
    const productId = tableId(product);
    const currencyId = tableId({ namespace: "medusa", logicalName: "commerce.currency/currency" });
    const clock = await fixture.persistence.getScopeClock(fixture.application.authority.scopeId);
    if (clock === null) throw new Error("Missing scope clock");
    const scope = projectScopeIdUuidV1(clock.scopeId);
    const epoch = projectScopeEpochUuidV1(clock.epoch);
    const publicationClock = { record: clock, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
    const inspect = <Value, Failure>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>) =>
      runEffectTransaction(txWork => fixture.persistence.drizzle.transaction(txWork),
        "Check shared strong-reference publication gate", work, cause => new Error("Publication gate transaction", { cause }));
    const head = await Effect.runPromise(inspect(tx => readBindingHeadProjection(tx, clock)));
    expect(head._tag).toBe("Some");
    if (head._tag !== "Some") throw new Error("Missing binding head");
    expect(head.value.frame.strongReferenceTableIds).toContain(productId);
    expect(head.value.frame.strongReferenceTableIds).not.toContain(currencyId);
    const publishedTables = await fixture.persistence.query<{ table_id: number }>(
      "select table_id from fx_system_commit_app_row_change where scope_uuid=$1 and commit_seq=$2",
      [scope.scopeUuid, clock.lastCommitSeq]);
    expect(publishedTables.rows.map(row => row.table_id)).toContain(currencyId);
    const observations: string[] = [];
    await Effect.runPromise(inspect(tx => requireStrongReferencePublication(tx, publicationClock,
      clock.lastCommitSeq, { observeQuery: query => observations.push(query.name) })));
    expect(observations).toEqual(["readBindingHead", "readStrongReferenceFacts"]);
  }, 120_000);

  it("rolls back a standalone Application point commit into a referenced table", async () => {
    const native = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(fixture.application, "insert"));
    expect(await Effect.runPromise(Effect.flip(native.publish)))
      .toMatchObject({ reason: "strongReferenceUnenforced" });
    await Effect.runPromise(native.verifyUnchanged);
  }, 120_000);
});
