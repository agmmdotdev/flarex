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

/** Native collection identity and its deterministic storage projection. */
export const PayloadCollectionSlugSchema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/),
  Schema.makeFilter(slug => slug === "users" || slug.startsWith("payload-") ||
    ["constructor", "prototype"].includes(slug) ? "Reserved Payload collection" : undefined),
);
export const payloadCollectionLogicalName = (slug: string): string => slug.replaceAll("-", "_");

const ScalarField = Schema.Struct({
  name: Identity,
  kind: Schema.Literals(["text", "number", "boolean", "date"]),
  unique: Schema.optionalKey(Schema.Literal(true)),
  defaultValue: Schema.optionalKey(Schema.Union([Schema.String,
    Schema.Finite.check(Schema.makeFilter(value => Object.is(value, -0) ? "Negative zero is not canonical" : undefined)), Schema.Boolean])),
}).annotate(StrictStructOptions).check(Schema.makeFilter(field => {
  if (field.unique !== undefined && field.kind !== "text") return "Only required text fields support uniqueness";
  const defaultType = field.kind === "text" || field.kind === "date" ? "string" : field.kind;
  return field.defaultValue === undefined || typeof field.defaultValue === defaultType ? undefined : "Default must match the scalar kind";
}));

const OptionalPostRelationField = Schema.Struct({
  name: Schema.Literal("relatedPost"), kind: Schema.Literal("relationship"),
  target: Schema.Literal("posts"), cardinality: Schema.Literal("one"),
  required: Schema.Literal(false), localized: Schema.Literal(false),
  onTargetDelete: Schema.Literal("restrict"),
}).annotate(StrictStructOptions);

const ManyPostRelationField = Schema.Struct({
  name: Schema.Literal("relatedPosts"), kind: Schema.Literal("relationship"),
  target: Schema.Literal("posts"), cardinality: Schema.Literal("many"),
  minItems: Schema.Literal(0), maxItems: Schema.Literal(32),
  localized: Schema.Literal(false), onTargetDelete: Schema.Literal("restrict"),
}).annotate(StrictStructOptions);

/** A private declarative profile, never a serialized executable Payload config. */
const ConfigurationFields = {
  format: Schema.Literal("flarex.payload-configuration"),
  version: Schema.Literal(3),
  provenanceSha256: Digest,
  tables: Schema.Array(Schema.Struct({
    logicalTableName: Identity,
    collectionSlug: PayloadCollectionSlugSchema,
    timestamps: Schema.Boolean,
    fields: Schema.Array(Schema.Union([ScalarField, OptionalPostRelationField, ManyPostRelationField])).check(Schema.isMaxLength(64)),
  }).annotate(StrictStructOptions)).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(APPLICATION_WRITE_POLICY_MAXIMUM_TABLES),
  ),
};
const Join = (name: "referencedBy" | "referencedByMany", on: "relatedPost" | "relatedPosts") => Schema.Struct({
  name: Schema.Literal(name), collection: Schema.Literal("posts"), on: Schema.Literal(on),
  orderable: Schema.Literal(false), localized: Schema.Literal(false), maxDepth: Schema.Literal(1),
  defaultLimit: Schema.Literal(8), maximumLimit: Schema.Literal(16),
}).annotate(StrictStructOptions);
export const PayloadConfigurationSchema = Schema.Union([
  Schema.Struct({ ...ConfigurationFields, profile: Schema.Literals(["payload.scalar", "payload.content-relations", "payload.content-many"]) }).annotate(StrictStructOptions),
  Schema.Struct({ ...ConfigurationFields, profile: Schema.Literal("payload.content-joins"),
    joins: Schema.Tuple([Join("referencedBy", "relatedPost"), Join("referencedByMany", "relatedPosts")]),
  }).annotate(StrictStructOptions),
]).check(Schema.makeFilter(config => {
  if (new Set(config.tables.map(table => table.collectionSlug)).size !== config.tables.length) return "Duplicate collection slug";
  for (const table of config.tables) {
    if (table.logicalTableName !== payloadCollectionLogicalName(table.collectionSlug)) return "Collection-to-table mapping mismatch";
    if (new Set(table.fields.map(field => field.name)).size !== table.fields.length) return "Duplicate field name";
    const managed = table.fields.filter(field => field.name === "createdAt" || field.name === "updatedAt");
    if (table.timestamps ? managed.length !== 2 || managed.some(field => field.kind !== "date" || field.defaultValue !== undefined || field.unique !== undefined) : managed.length !== 0) {
      return "Managed timestamps must agree with the declared date fields";
    }
  }
  if (config.tables.some(table => table.fields.filter(field => field.kind !== "relationship" && field.unique === true).length > 1)) {
    return "At most one unique text field is admitted per Payload table";
  }
  const many = config.profile === "payload.content-many" || config.profile === "payload.content-joins";
  const relations = config.tables.flatMap(table => table.fields.filter(field => field.kind === "relationship"));
  return config.profile === "payload.scalar"
    ? relations.length === 0 ? undefined : "Scalar profile cannot declare relationships"
    : config.tables.length === 1 && config.tables[0]?.logicalTableName === "posts" &&
      relations.length === (many ? 2 : 1) &&
      relations.filter(field => field.name === "relatedPost").length === 1 &&
      relations.filter(field => field.name === "relatedPosts").length === (many ? 1 : 0)
      ? undefined : "Expected the exact posts relationship profile";
}));
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
