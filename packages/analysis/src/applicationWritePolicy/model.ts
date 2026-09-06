import { Data, Schema } from "effect";

const StrictStructOptions = { parseOptions: { onExcessProperty: "error" } } as const;

export const APPLICATION_WRITE_POLICY_MAXIMUM_TABLES = 64;
export const APPLICATION_WRITE_POLICY_MAXIMUM_BYTES = 1_048_576;
export const APPLICATION_WRITE_POLICY_MAXIMUM_HISTORY_RECORDS = 64;
export const APPLICATION_WRITE_POLICY_MAXIMUM_HISTORY_BYTES = 1_048_576;

const Identity = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
);
const Digest = Schema.String.check(Schema.makeFilter(value =>
  /^[0-9a-f]{64}$/.test(value) ? undefined : "Expected lowercase SHA-256"
));

/** Separate npm and Git provenance facts; this does not assert equivalence. */
export const PayloadProvenanceSchema = Schema.Struct({
  format: Schema.Literal("flarex.payload-provenance"),
  version: Schema.Literal(1),
  package: Schema.Literal("payload"),
  release: Schema.Literal("3.88.0"),
  npmIntegrity: Schema.Literal("sha512-O7zuS80bvEGLte+7xZjwN05+ox5BCsGcQT2M6+CTote07JQOOvHJoiuoyQFw6cUElcFTWGMC5dy03w7J7sTYGg=="),
  gitTagObject: Schema.Literal("c54dea8f4010d9cb194780f2ee1e4b3ec697f9be"),
  gitCommit: Schema.Literal("fea6f8a47a50ff1330d8a5071b43e7dcffb97b22"),
}).annotate(StrictStructOptions);
export type PayloadProvenance = typeof PayloadProvenanceSchema.Type;

const ScalarField = Schema.Struct({
  name: Identity,
  kind: Schema.Literals(["text", "number", "boolean", "date"]),
}).annotate(StrictStructOptions);

/** A private declarative profile, never a serialized executable Payload config. */
export const PayloadConfigurationSchema = Schema.Struct({
  format: Schema.Literal("flarex.payload-configuration"),
  version: Schema.Literal(1),
  profile: Schema.Literal("payload.scalar"),
  provenanceSha256: Digest,
  tables: Schema.Array(Schema.Struct({
    logicalTableName: Identity,
    fields: Schema.Array(ScalarField).check(Schema.isMaxLength(64)),
  }).annotate(StrictStructOptions)).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(APPLICATION_WRITE_POLICY_MAXIMUM_TABLES),
  ),
}).annotate(StrictStructOptions);
export type PayloadConfiguration = typeof PayloadConfigurationSchema.Type;

export const ApplicationTableWritePolicySchema = Schema.Union([
  Schema.Struct({
    logicalTableName: Identity,
    owner: Schema.Literal("application"),
  }).annotate(StrictStructOptions),
  Schema.Struct({
    logicalTableName: Identity,
    owner: Schema.Literal("payload"),
    policyId: Schema.Literal("payload.scalar"),
    configSha256: Digest,
    provenanceSha256: Digest,
  }).annotate(StrictStructOptions),
]);
export type ApplicationTableWritePolicy =
  typeof ApplicationTableWritePolicySchema.Type;

export const ApplicationWritePoliciesSchema = Schema.Struct({
  format: Schema.Literal("flarex.application-table-write-policies"),
  version: Schema.Literal(1),
  provenance: PayloadProvenanceSchema,
  configuration: PayloadConfigurationSchema,
  tables: Schema.Array(ApplicationTableWritePolicySchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(APPLICATION_WRITE_POLICY_MAXIMUM_TABLES),
  ),
}).annotate(StrictStructOptions);
export type ApplicationWritePolicies = typeof ApplicationWritePoliciesSchema.Type;

export class ApplicationWritePolicyError extends Data.TaggedError(
  "ApplicationWritePolicyError",
)<{
  readonly reason:
    | "invalidInput"
    | "limitExceeded"
    | "noncanonicalOrder"
    | "tableCoverageMismatch"
    | "configurationMismatch"
    | "digestMismatch"
    | "digestUnavailable"
    | "historyLimitExceeded";
  readonly path: string;
}> {}
