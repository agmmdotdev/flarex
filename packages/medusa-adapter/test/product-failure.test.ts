import { Cause, Effect } from "effect";
import { expect, it } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import { coreProductSnapshot, coreProductNewMessages, installCoreProductDocumentFault } from "./support/core-product-checks";
import { getCoreProductRunnerFixture, productIntegrationTestRunner } from "./support/core-product-runner";

// Inspect only the error/cause chain, never SQL text or argument values.
function hasStatementCancellation(error: unknown): boolean {
  if (Cause.isCause(error)) return error.reasons.some(reason =>
    Cause.isFailReason(reason) && hasStatementCancellation(reason.error));
  return isNonArrayRecord(error) && (error.code === "57014" || hasStatementCancellation(error.cause));
}

productIntegrationTestRunner({ moduleName: "product", testSuite: () => {
  it.each(["row", "outcome"] as const)("preserves a shared %s statement cancellation and rolls back the complete command", async stage => {
    const { product, product: { host: writer } } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(product);
    // Exercise the real Core documents transaction at a business member and at
    // its committed outcome. Both drivers retain the server's SQLSTATE57014.
    const fault = await installCoreProductDocumentFault(product,
      { target: stage === "row" ? "product" : "outcome", at: 1, cancellation: true });
    const key = writer.newRequestKey();
    const input = { id: "failure-" + stage, title: "Failure " + stage };
    const command = product.runtime.commands.create;
    try {
      const error = await Effect.runPromise(Effect.flip(writer.run(key, command, input)));
      expect(error.reason).toBe("resourceFailure");
      expect(hasStatementCancellation(error)).toBe(true);
      expect(await coreProductSnapshot(product)).toEqual(before);
      // Sequences survive rollback: exactly one trigger visit proves that the
      // failed statement was not automatically replayed inside this request.
      expect(await fault.visits()).toEqual([{ count: 1, is_called: true }]);
    } finally { await fault.close(); }
    const created = await Effect.runPromise(writer.run(key, command, input));
    const after = await coreProductSnapshot(product);
    expect(coreProductNewMessages(before, after)).toHaveLength(1);
    expect(await Effect.runPromise(writer.run(key, command, input))).toEqual(created);
    expect(await coreProductSnapshot(product)).toEqual(after);
  });
} });
