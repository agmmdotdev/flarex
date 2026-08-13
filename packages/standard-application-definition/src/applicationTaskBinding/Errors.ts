import { Data } from "effect";
import type { CanonicalJsonEncodingInvariantIssue } from "flarex-protocol/json";

export type ApplicationTaskBindingOperationV1 =
  | "decode_catalog_binding"
  | "decode_definition_binding"
  | "encode_catalog_binding"
  | "encode_definition_binding"
  | "decode_runtime_target"
  | "encode_runtime_target"
  | "hash_runtime_target"
  | "hash_catalog_binding"
  | "hash_definition_binding"
  | "produce";

export type ApplicationTaskBindingReasonV1 =
  | "invalidShape"
  | "invalidAuthority"
  | "invalidRuntimePolicy"
  | "invalidCatalog"
  | "catalogDigestMismatch"
  | "manifestDigestMismatch"
  | "handlerMappingMissing"
  | "handlerMappingMismatch"
  | "sourceModuleMissing"
  | "canonicalBytesExceeded";

export class InvalidApplicationTaskBindingV1Error extends Data.TaggedError(
  "InvalidApplicationTaskBindingV1Error",
)<{
  readonly operation: ApplicationTaskBindingOperationV1;
  readonly reason: ApplicationTaskBindingReasonV1;
  readonly path?: string;
}> {}

export class ApplicationTaskBindingCanonicalEncodingV1Defect
  extends Data.TaggedError("ApplicationTaskBindingCanonicalEncodingV1Defect")<{
    readonly operation: ApplicationTaskBindingOperationV1;
    readonly issue: CanonicalJsonEncodingInvariantIssue;
  }> {}

export class ApplicationTaskBindingSha256InvariantV1Defect
  extends Data.TaggedError("ApplicationTaskBindingSha256InvariantV1Defect")<{
    readonly operation: ApplicationTaskBindingOperationV1;
    readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  }> {}
