import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { closeInstallationAdmission, initializeFullProofInstallation, loadManagedInstallation,
  lockInstallationForCurrentTransaction, verifyInstallationWriterProtection } from "../src/installationLifecycle";
import { newTestPGlite } from "./pgliteSearchExtensions";

describe("installation full-proof compatibility", () => {
  it("joins the active gate, refuses inactive serving and detects removed writer protection", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      await persistence.drizzle.transaction(async tx => {
        await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
        closeInstallationAdmission(tx);
      });
      await expect(Effect.runPromise(loadManagedInstallation(persistence.drizzle, "unpublished", "public")))
        .rejects.toMatchObject({ reason: "invalidInstallation" });
      await persistence.query("update fx_system_installation set state = 'unverified'");
      await expect(persistence.drizzle.transaction(tx => Effect.runPromise(lockInstallationForCurrentTransaction(tx))))
        .rejects.toMatchObject({ reason: "inactive" });
      await expect(persistence.query("update fx_system_scope_clock set epoch = epoch where false"))
        .rejects.toMatchObject({ code: "55000" });
      await Effect.runPromise(initializeFullProofInstallation(persistence.drizzle));
      await persistence.query("drop trigger fx_00_installation_admission on fx_system_scope_clock");
      await expect(Effect.runPromise(verifyInstallationWriterProtection(persistence.drizzle, "public")))
        .rejects.toMatchObject({ reason: "invalidInstallation" });
    } finally { await db.close(); }
  }, 180_000);
});
