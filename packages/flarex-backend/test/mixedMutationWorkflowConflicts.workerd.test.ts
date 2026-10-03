import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxAppRowRevisions } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/pointCommitTransaction";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const WorkerSuccess = Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) });
const WorkflowResult = Schema.Struct({ workflow: Schema.Struct({ pricing: Schema.Struct({
  variants: Schema.Array(Schema.Struct({ id: Schema.String })),
  priceSets: Schema.Array(Schema.Struct({ id: Schema.String })),
  links: Schema.Array(Schema.Struct({ variant_id: Schema.String, price_set_id: Schema.String })),
}) }) });
const ProductOptions = Schema.Struct({ options: Schema.Array(Schema.Struct({ id: Schema.String,
  title: Schema.String })) });

const races = [
  {
    name: "Product option value removal",
    write: async (fixture: Fixture, variantId: string, priceSetId: string) => {
      void variantId; void priceSetId;
      const option = Schema.decodeUnknownSync(ProductOptions)(fixture.baseline).options
        .find(value => value.title === "Size");
      if (option === undefined) throw new Error("Missing seeded Size option");
      return fixture.runStandaloneProductMutation("replaceOptionValues", { id: fixture.seed.productId,
        data: { options: [{ id: option.id, title: "Size", values: ["1"] }] } });
    },
    connection: "product",
  },
  {
    name: "duplicate Size zero Variant combination",
    write: (fixture: Fixture, variantId: string, priceSetId: string) => {
      void priceSetId;
      return fixture.runStandaloneProductMutation("createVariant", [{
        id: `${variantId}_racer`, product_id: fixture.seed.productId,
        title: "Standalone duplicate", options: { Size: "0" },
      }]);
    },
    connection: "product",
  },
  {
    name: "Link active Variant–PriceSet pair claim",
    write: (fixture: Fixture, variantId: string, priceSetId: string) =>
      fixture.runStandaloneLinkCreate(variantId, priceSetId),
    connection: "link",
  },
  {
    name: "Product Tag point value change",
    write: (fixture: Fixture, variantId: string, priceSetId: string) => {
      void variantId; void priceSetId;
      return fixture.runStandaloneProductMutation("updateTag", { selector: { id: fixture.seed.tagId },
        update: { value: "changed-before-launch" } });
    },
    connection: "product",
  },
  {
    name: "another Product Tag claiming launched",
    write: (fixture: Fixture, variantId: string, priceSetId: string) => {
      void variantId; void priceSetId;
      return fixture.runStandaloneProductMutation("createTag", { id: `ptag_race_${fixture.seed.tagId}`,
        value: "launched" });
    },
    connection: "product",
  },
  {
    name: "Product.tags membership change",
    write: (fixture: Fixture, variantId: string, priceSetId: string) => {
      void variantId; void priceSetId;
      return fixture.runStandaloneProductMutation("removeProductTag", { id: fixture.seed.productId,
        data: { tag_ids: [] } });
    },
    connection: "product",
  },
] as const;

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)(
  "mixed native Product workflow historical conflicts on ordinary PostgreSQL", () => {
    it.each(races)("rejects $name from a separate standalone connection", async race => {
      const suffix = `launch-race-${races.indexOf(race)}`;
      const variantId = `pvar_${suffix}`;
      const priceSetId = `pset_${suffix}`;
      const fixture = await createMixedMutationProductFixture({ driver: "postgres", workflow: true,
        suffix, payloadProfile: "success", workflowIds: { variantId, priceSetId } });
      try {
        const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
        const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
          success.result.result))).value;
        const workflow = Schema.decodeUnknownSync(WorkflowResult)(returnedValue).workflow;
        expect(workflow.pricing.variants).toMatchObject([{ id: variantId }]);
        expect(workflow.pricing.priceSets).toMatchObject([{ id: priceSetId }]);
        expect(workflow.pricing.links).toMatchObject([{
          variant_id: variantId, price_set_id: priceSetId,
        }]);
        await race.write(fixture, variantId, priceSetId);
        const connections = race.connection === "product"
          ? fixture.standaloneProductPgConnections : fixture.standaloneLinkPgConnections;
        expect(connections).toHaveLength(1);
        expect(connections[0]?.standalonePid).not.toBe(connections[0]?.primaryTargetPid);
        const conflict = await fixture.prepareOccPublication(returnedValue)
          .then(publication => Effect.runPromise(publication)).then(() => null, cause => cause);
        expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
        if (!(conflict instanceof PointCommitConflictV1Error))
          throw new Error(`Expected OCC conflict for ${race.name}`);
        expect(conflict.currentCommitSeq).toBeGreaterThan(conflict.snapshotCommitSeq);
        const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
        const uncommitted = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
            eq(fxAppRowRevisions.tableId, CatalogTableIdSchema.make(1))));
        expect(uncommitted).toHaveLength(0);
        const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
        expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      } finally { await fixture.close(); }
    }, 240_000);
  });
