declare module "flarex:function-api-core/v1" {
  export const createFunctionRuntimeAuthV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createFunctionRuntimeAuthV1;
  export const createQueryFunctionRuntimeBaseContextV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createQueryFunctionRuntimeBaseContextV1;
  export const createMutationFunctionRuntimeBaseContextV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createMutationFunctionRuntimeBaseContextV1;
}
