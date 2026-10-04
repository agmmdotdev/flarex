import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { logicalCurrencyFixture } from "../../medusa-adapter/test/support/logical-currency-fixture";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { backfillBindingMetadataProjections } from "../src/frameworkSchema/binding/repository";
import { finiteMetadataContractKey } from "../src/finiteMetadataDependencies";
import { fxSystemMetadataContractObservations, fxSystemScopeClocks } from "../src/schema";
import { runEffect } from "./effectTestRuntime";

/** Real split catalogs and a canonical activated logical binding. The absent
 * obsolete row models restored derived metadata at an actual current sequence;
 * it never grants historical authority or supplies an attempt watermark. */
export async function bindingMetadataBackfillScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
    const target = fixture.persistence.drizzle;
    const control = fixture.control.drizzle;
    const scopeId = decodeReplacementScopeIdV1(fixture.application.authority.scopeId);
    const rows = () => target.select().from(fxSystemMetadataContractObservations)
      .where(eq(fxSystemMetadataContractObservations.scopeId, scopeId)).orderBy(
        fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey,
        fxSystemMetadataContractObservations.contractKey);
    const watermark = async () => {
      const [clock] = await target.select({ sequence: fxSystemScopeClocks.lastMetadataSequence })
        .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId));
      if (clock === undefined) throw new Error("Missing real scope sequence");
      return clock.sequence;
    };
    const initial = await rows();
    const originalWatermark = await watermark();
    const native = initial.filter(row => row.namespace === "application" || row.namespace === "execution");
    expect(native.some(row => row.namespace === "application")).toBe(true);
    expect(native.some(row => row.namespace === "execution")).toBe(true);
    const required = initial.find(row => row.namespace === "binding" && row.ownerKey === "application" && row.present);
    if (required === undefined) throw new Error("Missing actual bound Application contract");
    // The target is genuine, but its empty control catalog cannot authenticate
    // the selected immutable logical version. Refusal must precede writes.
    await expect(runEffect(backfillBindingMetadataProjections(target, target))).rejects.toMatchObject({ reason: "storedCorruption" });
    expect(await rows()).toEqual(initial);
    expect(await watermark()).toBe(originalWatermark);
    await runEffect(backfillBindingMetadataProjections(target, control));
    await runEffect(backfillBindingMetadataProjections(target, control));
    expect(await rows()).toEqual(initial);
    expect(await watermark()).toBe(originalWatermark);

    const obsoleteKey = finiteMetadataContractKey("restoredObsoleteContract", "binding-backfill-test");
    await target.insert(fxSystemMetadataContractObservations).values({ scopeId, namespace: "binding",
      ownerKey: required.ownerKey, contractKey: obsoleteKey, present: false, semanticSha256Hex: null,
      lastChangedMetadataSequence: originalWatermark });
    const restored = await rows();
    const tombstone = restored.find(row => row.contractKey === obsoleteKey);
    if (tombstone === undefined) throw new Error("Missing restored derived tombstone");
    await target.delete(fxSystemMetadataContractObservations).where(and(
      eq(fxSystemMetadataContractObservations.scopeId, scopeId),
      eq(fxSystemMetadataContractObservations.namespace, required.namespace),
      eq(fxSystemMetadataContractObservations.ownerKey, required.ownerKey),
      eq(fxSystemMetadataContractObservations.contractKey, required.contractKey)));
    await runEffect(backfillBindingMetadataProjections(target, control));
    const repaired = await rows();
    const repairedWatermark = await watermark();
    expect(repairedWatermark).toBe(originalWatermark + 1n);
    expect(repaired.filter(row => row.namespace === "application" || row.namespace === "execution")).toEqual(native);
    expect(repaired.find(row => row.contractKey === obsoleteKey)).toEqual(tombstone);
    expect(repaired.find(row => row.namespace === required.namespace && row.ownerKey === required.ownerKey &&
      row.contractKey === required.contractKey)).toEqual({ ...required, lastChangedMetadataSequence: repairedWatermark });
    await runEffect(backfillBindingMetadataProjections(target, control));
    expect(await rows()).toEqual(repaired);
    expect(await watermark()).toBe(repairedWatermark);
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
}
