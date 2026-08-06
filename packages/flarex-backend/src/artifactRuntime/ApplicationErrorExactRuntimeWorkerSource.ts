export const APPLICATION_ERROR_PLATFORM_MODULE_V1 =
  "_flarex/application-error-platform-v1.js";
export const APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1 = "flarex/values";

export const APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1 =
  `// Public Flarex value-domain facade for one exact Worker.
export { FlarexError } from "../_flarex/application-error-platform-v1.js";
`;

export type ApplicationErrorInvalidProjectionV1 =
  | Readonly<{ readonly kind: "nativeError" }>
  | Readonly<{
      readonly kind: "profileApplicationError";
      readonly exportName: string;
      readonly reason: string;
    }>;

export interface ApplicationErrorPlatformSourceV1Input {
  readonly runtimeKernelModulePath: string;
  readonly captureExportName: string;
  readonly invalid: ApplicationErrorInvalidProjectionV1;
}

export function applicationErrorPlatformSourceV1(
  input: ApplicationErrorPlatformSourceV1Input,
): string {
  const profileImport = input.invalid.kind === "profileApplicationError"
    ? `${input.captureExportName},\n  ${input.invalid.exportName},`
    : `${input.captureExportName},`;
  const invalidProjection = input.invalid.kind === "profileApplicationError"
    ? `throw new ${input.invalid.exportName}(${JSON.stringify(input.invalid.reason)}, detailV1);`
    : `const errorV1 = new Error(detailV1 ?? "Invalid FlarexError construction.");\n    Object.defineProperty(errorV1, "name", { value: "FlarexErrorConstructionV1Error" });\n    throw errorV1;`;
  return `// Host-private application-error registry for one exact Worker.
import { createFunctionRuntimeApplicationErrorRegistryV1 } from "../flarex:function-api-core/v1";
import {
  ${profileImport}
} from ${JSON.stringify(input.runtimeKernelModulePath)};
const coreApplicationErrorsV1 = createFunctionRuntimeApplicationErrorRegistryV1(
  ${input.captureExportName},
  (detailV1) => {
    ${invalidProjection}
  },
);
export const FlarexError = coreApplicationErrorsV1.FlarexError;
export function inspectCoreApplicationErrorV1(valueV1) {
  return coreApplicationErrorsV1.inspect(valueV1);
}
`;
}
