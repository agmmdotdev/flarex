import { Effect } from "effect";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile } from "../src/commerceTransaction/profile";
import type { commerceHostFixture } from "./commerceHostFixture";

/** Authored table declarations only; installation and admission use real owners. */
export const prepareNeutralCommerceProfile = (names: readonly string[], lineageId = "independent-profiles") =>
  Effect.fn(function* (deploymentId: string, target: Parameters<Parameters<typeof commerceHostFixture>[2]>[1]) {
    const origin = { kind: "authored", sourceId: `test.${lineageId}` };
    const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
      provenance: { kind: "sourceSnapshot", repository: `https://example.com/${lineageId}`, revision: "d".repeat(40), paths: ["model.ts"] },
      schema: { owner: "medusa", lineageId, tables: names.map(tableId => ({ tableId, origin,
        columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
          { columnId: "value", type: "integer", nullable: false, default: { kind: "none" }, origin }],
        keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] })), capabilities: [] },
    });
    const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
    const first = names[0];
    if (first === undefined) throw new Error("Missing neutral fixture table");
    const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, `test.${first}`, [{ tableId: first, keyId: `${first}.primary` }]);
    return { profile, initialization: { rows: undefined } };
  });
