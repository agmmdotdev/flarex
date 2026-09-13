import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadConfiguredRelationshipScenario } from "./payloadConfiguredRelationshipScenario";

it.each([["authors", "author"], ["article-authors", "editor"]])("compiles and runs articles -> %s via %s", async (target, field) => {
  const fixture = await createRelationalPGliteFixture({ fileBacked: true });
  await payloadConfiguredRelationshipScenario(fixture.persistence, fixture.session, target, field, fixture.reopen);
}, 180000);
