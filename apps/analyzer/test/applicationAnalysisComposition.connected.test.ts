import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";
import { describe, expect, it } from "vitest";

import { proveConnectedApplicationAnalysis } from
  "./applicationAnalysisComposition.connected";

describe("Application Analysis connected composition", () => {
  it("settles, replays, and publishes through the post-retirement PGlite schema", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    const proof = await proveConnectedApplicationAnalysis(
      persistence,
      crypto.randomUUID(),
    );

    expect(proof.replay).toEqual(proof.first);
    expect(proof.hostCalls).toBe(1);
    expect(proof.revisionCount).toBe("1");
    expect(proof.publication.revisionId).toBe(proof.stored.revision.revisionId);
    expect(proof.runtimeTarget.target.function.path).toBe("status:get");
  });
});
