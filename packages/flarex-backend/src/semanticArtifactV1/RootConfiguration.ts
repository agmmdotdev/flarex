import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Result } from "effect";

export interface SemanticArtifactV1RootConfiguration {
  readonly semanticModelIdentity: string;
  readonly semanticCodecIdentity: string;
  readonly semanticPolicyIdentity: string;
  readonly coreLanguageIdentity: string;
  readonly abiIdentity: string;
  readonly grammarIdentity: string;
  readonly unicodeIdentity: string;
  readonly parserTableIdentity: string;
  readonly trustedToolingIdentity: string;
  readonly ingressProtocolIdentity: string;
  readonly ingressConfigurationIdentity: string;
}

export type SemanticArtifactV1RootConfigurationField =
  | keyof SemanticArtifactV1RootConfiguration
  | "rootConfiguration";

export class SemanticArtifactV1RootConfigurationError extends Data.TaggedError(
  "SemanticArtifactV1RootConfigurationError",
)<{ readonly field: SemanticArtifactV1RootConfigurationField }> {}

const ROOT_CONFIGURATION_FIELDS = Object.freeze({
  abiIdentity: true,
  coreLanguageIdentity: true,
  grammarIdentity: true,
  ingressConfigurationIdentity: true,
  ingressProtocolIdentity: true,
  parserTableIdentity: true,
  semanticCodecIdentity: true,
  semanticModelIdentity: true,
  semanticPolicyIdentity: true,
  trustedToolingIdentity: true,
  unicodeIdentity: true,
} as const satisfies Readonly<
  Record<keyof SemanticArtifactV1RootConfiguration, true>
>);

const ROOT_CONFIGURATION_KEYS = Object.freeze(
  Object.keys(ROOT_CONFIGURATION_FIELDS) as
    (keyof SemanticArtifactV1RootConfiguration)[],
);

export function captureSemanticArtifactV1RootConfiguration(
  input: unknown,
): Result.Result<
  SemanticArtifactV1RootConfiguration,
  SemanticArtifactV1RootConfigurationError
> {
  if (
    !isNonArrayRecord(input) ||
    !hasExactKeys(input, ROOT_CONFIGURATION_KEYS)
  ) {
    return Result.fail(
      new SemanticArtifactV1RootConfigurationError({
        field: "rootConfiguration",
      }),
    );
  }
  return Result.gen(function* () {
    const semanticModelIdentity = yield* captureField(
      input,
      "semanticModelIdentity",
    );
    const semanticCodecIdentity = yield* captureField(
      input,
      "semanticCodecIdentity",
    );
    const semanticPolicyIdentity = yield* captureField(
      input,
      "semanticPolicyIdentity",
    );
    const coreLanguageIdentity = yield* captureField(
      input,
      "coreLanguageIdentity",
    );
    const abiIdentity = yield* captureField(input, "abiIdentity");
    const grammarIdentity = yield* captureField(input, "grammarIdentity");
    const unicodeIdentity = yield* captureField(input, "unicodeIdentity");
    const parserTableIdentity = yield* captureField(
      input,
      "parserTableIdentity",
    );
    const trustedToolingIdentity = yield* captureField(
      input,
      "trustedToolingIdentity",
    );
    const ingressProtocolIdentity = yield* captureField(
      input,
      "ingressProtocolIdentity",
    );
    const ingressConfigurationIdentity = yield* captureField(
      input,
      "ingressConfigurationIdentity",
    );
    return Object.freeze({
      semanticModelIdentity,
      semanticCodecIdentity,
      semanticPolicyIdentity,
      coreLanguageIdentity,
      abiIdentity,
      grammarIdentity,
      unicodeIdentity,
      parserTableIdentity,
      trustedToolingIdentity,
      ingressProtocolIdentity,
      ingressConfigurationIdentity,
    });
  });
}

export function semanticArtifactV1RootConfigurationsEqual(
  left: SemanticArtifactV1RootConfiguration,
  right: SemanticArtifactV1RootConfiguration,
): boolean {
  return ROOT_CONFIGURATION_KEYS.every(
    key => left[key] === right[key],
  );
}

function captureField<K extends keyof SemanticArtifactV1RootConfiguration>(
  input: Readonly<Record<string, unknown>>,
  field: K,
): Result.Result<
  SemanticArtifactV1RootConfiguration[K],
  SemanticArtifactV1RootConfigurationError
> {
  const value = input[field];
  return isNonEmptyString(value)
    ? Result.succeed(value)
    : Result.fail(new SemanticArtifactV1RootConfigurationError({ field }));
}

function hasExactKeys(
  input: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(input).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}
