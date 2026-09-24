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
});
