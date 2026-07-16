import type {
  VerifiedTransactionGrantInspectionV1,
} from "../transactionGrantVerificationKernel";

export function detachVerifiedGrant(
  input: VerifiedTransactionGrantInspectionV1,
): VerifiedTransactionGrantInspectionV1 {
  return Object.freeze(structuredClone(input));
}
