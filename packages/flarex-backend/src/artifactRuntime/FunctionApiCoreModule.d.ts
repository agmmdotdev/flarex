declare module "flarex:function-api-core/v1" {
  export const createFunctionRuntimePointDatabaseWriterV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createFunctionRuntimePointDatabaseWriterV1;
  export const createFunctionRuntimePointReaderV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createFunctionRuntimePointReaderV1;
  export const createFunctionRuntimeAuthV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createFunctionRuntimeAuthV1;
  export const createQueryFunctionRuntimeContextV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createQueryFunctionRuntimeContextV1;
  export const createMutationFunctionRuntimeContextV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createMutationFunctionRuntimeContextV1;
  export const createFunctionRuntimeApplicationErrorRegistryV1:
    typeof import("@flarex/function-runtime/internal/function-api-core-v1")
      .createFunctionRuntimeApplicationErrorRegistryV1;
}
