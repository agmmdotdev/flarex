import { Effect } from "effect";
import { expect } from "vitest";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { makeCmsHost } from "../src/cmsTransaction/host";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { cmsHostFixture } from "./cmsHostFixture";
import { preparedHostTestRuntime } from "./preparedHostRuntimeTestSupport";
import { runEffect } from "./effectTestRuntime";

/** A read-only host's retained schema is larger than one command's 32 key transitions. */
export async function payloadManyCollectionsScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession) {
  const compiled = await runEffect(compilePayloadCollections(Array.from({ length: 33 }, (_, index) => ({
    slug: `collection-${index}`, fields: [{ name: "title", type: "text", required: true, unique: true }],
  }))));
  const { fixture } = await cmsHostFixture(persistence, {}, compiled);
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(compiled);
    let scans = 0;
    const host = yield* Effect.acquireRelease(makeCmsHost({ hostRuntime: preparedHostTestRuntime(persistence.drizzle),
      database: persistence.drizzle, controlDatabase: fixture.control.drizzle, session,
      deploymentId: fixture.deploymentId, authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority,
      application: fixture.relationActivation, identityAndAccessPolicy: { subject: "many-collection-reader" },
      commands: [runtime.commands.find, runtime.commands.count], materialization: {},
    }, { documentReads: { beforeRead: selection => Effect.sync(() => { if (selection === "scan") scans++; }) } }), value => value.close);
    for (const collection of ["collection-0", "collection-32"]) {
      expect(yield* host.read(runtime.commands.count, { collection, where: { title: { equals: "absent" } } })).toEqual({ totalDocs: 0 });
    }
    expect(scans).toBe(0);
  })));
}
