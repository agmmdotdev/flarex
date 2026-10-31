import { Effect } from "effect";
import { CoreAccounting, CORE_TRANSACTION_REFERENCE_LIMITS } from "../../src/core/accounting";

export const CORE_NATIVE_TEST_LIMITS = Object.freeze({ maxIdentities: 256, maxDocumentBytes: 65_536 });

/** Direct Core tests use its real accounting owner as the trusted caller budget.
 * Genuine CMS tests separately prove sharing the native request's own counter. */
export function coreNativeTestBudget() {
  const accounting = new CoreAccounting({ ...CORE_TRANSACTION_REFERENCE_LIMITS, bytesRead: 1_048_576 });
  return { limits: CORE_NATIVE_TEST_LIMITS,
    chargeRetained: (bytes: number) => Effect.fromResult(accounting.read(false, bytes)) };
}
