export const FlarexError: import("@flarex/function-runtime/internal/function-api-core-v1")
  .FunctionRuntimeFlarexErrorConstructorV1;
export function inspectCoreApplicationErrorV1(value: unknown): boolean;
export function captureCoreApplicationErrorV1(value: unknown):
  | Readonly<{
      readonly code: string;
      readonly message: string;
      readonly data?: import("flarex-protocol/value").CanonicalFlarexRuntimeValueV1;
    }>
  | null;
