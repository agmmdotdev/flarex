import { BasePayload, createLocalReq, validations, type CollectionConfig, type PayloadRequest } from "payload";
import { Effect, Schema } from "effect";
import { applicationSchemaDefinition, applicationTableDefinition } from "@flarex/application-schema-definition/application-schema";
import { applicationObjectValidatorJson, applicationScalarValidatorJson } from "@flarex/application-schema-definition/validator-json";
import { captureApplicationWritePolicyData, digestApplicationWritePolicyFrame, verifyApplicationWritePolicies,
  PayloadCollectionSlugSchema, payloadCollectionLogicalName,
  type PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import { SchemaManifestAppTableNameSchema } from "flarex-protocol/schema-manifest";
import { cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadDatabaseAdapter } from "./adapter";
import { buildPayloadConfiguration } from "./configuration";
import { payloadScalarProvenance } from "./contract";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const FieldName = SchemaManifestAppTableNameSchema.check(Schema.makeFilter(name =>
  ["id", "createdAt", "updatedAt", "constructor", "prototype"].includes(name) ? "Reserved field name" : undefined));
const common = { name: FieldName, required: Schema.Literal(true) };
const NumberDefault = Schema.Finite.check(Schema.makeFilter(value => Object.is(value, -0) ? "Negative zero is not canonical" : undefined));
const NativeField = Schema.Union([
  Schema.Struct({ ...common, type: Schema.Literal("text"), unique: Schema.optionalKey(Schema.Literal(true)), defaultValue: Schema.optionalKey(Schema.String) }).annotate(strict),
  Schema.Struct({ ...common, type: Schema.Literal("number"), defaultValue: Schema.optionalKey(NumberDefault) }).annotate(strict),
  Schema.Struct({ ...common, type: Schema.Literal("checkbox"), defaultValue: Schema.optionalKey(Schema.Boolean) }).annotate(strict),
  Schema.Struct({ ...common, type: Schema.Literal("date"), defaultValue: Schema.optionalKey(Schema.String) }).annotate(strict),
]);
type NativeField = typeof NativeField.Type;
const decodeField = Schema.decodeUnknownEffect(NativeField);
const NativeCollections = Schema.Array(Schema.Struct({
  slug: PayloadCollectionSlugSchema,
  fields: Schema.Array(NativeField).check(Schema.isMinLength(1), Schema.isMaxLength(62)),
  timestamps: Schema.optionalKey(Schema.Literal(true)),
  lockDocuments: Schema.optionalKey(Schema.Literal(false)),
  enableQueryPresets: Schema.optionalKey(Schema.Literal(false)),
  defaultSort: Schema.optionalKey(Schema.Literal("id")),
}).annotate(strict)).check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.makeFilter(collections => {
  // Slugs remain native. Only the compiler chooses the separate logical name;
  // ambiguous underscore/hyphen mappings are refused, never silently merged.
  if (new Set(collections.map(collection => payloadCollectionLogicalName(collection.slug))).size !== collections.length) return "Duplicate logical collection identity";
  return collections.some(collection => new Set(collection.fields.map(field => field.name)).size !== collection.fields.length ||
    collection.fields.filter(field => field.type === "text" && field.unique).length > 1) ? "Duplicate fields or multiple unique fields" : undefined;
}));
const decodeCollections = Schema.decodeUnknownEffect(NativeCollections);
const access = { read: () => true, create: () => true, update: () => true, delete: () => true };
const compiledCollections = new WeakSet<object>();

function nativeCollection(collection: typeof NativeCollections.Type[number]): CollectionConfig {
  return { slug: collection.slug, fields: collection.fields.map(field => ({ ...field })),
    timestamps: true, lockDocuments: false, enableQueryPresets: false, defaultSort: "id", access: { ...access } };
}

const validateDefault = Effect.fn("PayloadCollections.validateDefault")(function* (
  field: NativeField, req: PayloadRequest, collectionSlug: string,
) {
  if (field.defaultValue === undefined) return;
  const options = { req, collectionSlug, path: [field.name], data: {}, siblingData: {}, blockData: {}, preferences: { fields: {} }, operation: "create" as const };
  // Public native validators own default validity. No user callbacks survive capture.
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: invariant - The four pinned pure validators return validation messages, not operational rejections; an unexpected throw/rejection is a defect.
  const result = yield* Effect.promise(async () => {
    if (field.defaultValue === undefined) return true;
    switch (field.type) {
      case "text": return validations.text(field.defaultValue, { ...options, ...field });
      case "number": return validations.number(field.defaultValue, { ...options, ...field });
      case "checkbox": return validations.checkbox(field.defaultValue, { ...options, ...field });
      case "date": return validations.date(new Date(field.defaultValue), { ...options, ...field });
    }
  });
  if (result !== true) return yield* Effect.fail(cmsError("unsupportedProfile", { collectionSlug, field: field.name, message: result }));
});

/** Construction-time only. This issues declarations, not schema or request authority. */
export const compilePayloadCollections = Effect.fn("PayloadCollections.compile")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(captureApplicationWritePolicyData(input)).pipe(
    Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
  const definitions = yield* decodeCollections(captured).pipe(Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
  const config = yield* buildPayloadConfiguration(definitions.map(nativeCollection), makePayloadDatabaseAdapter("payload.scalar"));
  const expectedInventory = [...definitions.map(collection => collection.slug), "users", "payload-preferences", "payload-migrations"].toSorted();
  if (config.collections.map(collection => collection.slug).toSorted().join() !== expectedInventory.join() || config.globals.length !== 0) {
    return yield* Effect.fail(cmsError("unsupportedProfile", "sanitized collection inventory"));
  }
  // Uninitialized, resource-free native context for the four pure field validators.
  // Neither init nor a Local API/database operation is executed by compilation.
  const validationPayload = new BasePayload();
  validationPayload.config = config;
  const req = yield* Effect.tryPromise({ try: () => createLocalReq({}, validationPayload), catch: cause => cmsError("unsupportedProfile", cause) });
  const tables: PayloadConfiguration["tables"][number][] = [];
  for (const definition of definitions) {
    const sanitized = config.collections.find(collection => collection.slug === definition.slug);
    const names = [...definition.fields.map(field => field.name), "updatedAt", "createdAt"];
    if (sanitized === undefined || sanitized.timestamps !== true || sanitized.lockDocuments !== false || sanitized.defaultSort !== "id" ||
      sanitized.fields.length !== names.length) return yield* Effect.fail(cmsError("unsupportedProfile", "sanitized collection semantics"));
    const fields: PayloadConfiguration["tables"][number]["fields"][number][] = [];
    for (const [position, field] of sanitized.fields.entries()) {
      if (!("name" in field) || field.name !== names[position]) return yield* Effect.fail(cmsError("unsupportedProfile", "sanitized field order"));
      if (field.name === "updatedAt" || field.name === "createdAt") {
        if (field.type !== "date" || field.defaultValue !== undefined) return yield* Effect.fail(cmsError("unsupportedProfile", "managed timestamps"));
        fields.push({ name: field.name, kind: "date" });
        continue;
      }
      const native = yield* decodeField({ name: field.name, type: field.type, required: "required" in field ? field.required : undefined,
        ...("unique" in field && field.unique === true ? { unique: true } : {}),
        ...("defaultValue" in field && field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
      }).pipe(Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
      const source = definition.fields[position];
      if (source === undefined || native.type !== source.type ||
        (native.type === "text" && native.unique) !== (source.type === "text" && source.unique) ||
        native.defaultValue !== (source.defaultValue === undefined && source.type === "checkbox" ? false : source.defaultValue)) {
        return yield* Effect.fail(cmsError("unsupportedProfile", "sanitized field semantics"));
      }
      yield* validateDefault(native, req, definition.slug);
      fields.push({ name: native.name, kind: native.type === "checkbox" ? "boolean" : native.type,
        ...(native.type === "text" && native.unique ? { unique: true as const } : {}),
        ...(native.defaultValue === undefined ? {} : { defaultValue: native.defaultValue }) });
    }
    tables.push({ logicalTableName: payloadCollectionLogicalName(definition.slug), collectionSlug: definition.slug, timestamps: true, fields });
  }
  tables.sort((left, right) => left.logicalTableName < right.logicalTableName ? -1 : left.logicalTableName > right.logicalTableName ? 1 : 0);
  const provenanceSha256 = yield* digestApplicationWritePolicyFrame(payloadScalarProvenance);
  const configuration: PayloadConfiguration = { format: "flarex.payload-configuration", version: 3, profile: "payload.scalar", provenanceSha256, tables };
  const configSha256 = yield* digestApplicationWritePolicyFrame(configuration);
  const verified = yield* verifyApplicationWritePolicies({ format: "flarex.application-table-write-policies", version: 1,
    provenance: payloadScalarProvenance, configuration, tables: tables.map(table => ({ logicalTableName: table.logicalTableName,
      owner: "payload", policyId: "payload.scalar", configSha256, provenanceSha256 })) }, tables.map(table => table.logicalTableName));
  // The shared schema authoring owner validates identifiers and owns validator copies.
  // All inputs below are compiler-owned; a failure here is an invariant defect.
  const schema = applicationSchemaDefinition(Object.fromEntries(tables.map(table => [table.logicalTableName,
    applicationTableDefinition(applicationObjectValidatorJson(Object.fromEntries(table.fields.map(field => [field.name, {
      fieldType: applicationScalarValidatorJson(field.kind === "number" ? "number" : field.kind === "boolean" ? "boolean" : "string"), optional: false,
    }])))),
  ])));
  const schemaDefinition = Object.freeze({ tables: Object.freeze(Object.fromEntries(schema.tables.map(table => [table.logicalName,
    Object.freeze({ kind: "table", validator: Object.freeze({ isFlarexValidator: true, json: table.definition.documentType }), indexes: Object.freeze([]) }),
  ]))), relations: Object.freeze([]), writePolicies: verified.policies });
  const compiled = Object.freeze({ configuration: verified.policies.configuration, schemaDefinition,
    contentIdentity: Object.freeze({ configSha256, provenanceSha256 }),
    // New owned objects on every call; native sanitation cannot mutate compiler evidence.
    createNativeCollections: () => definitions.map(nativeCollection) });
  compiledCollections.add(compiled);
  return compiled;
});

export type CompiledPayloadCollections = Effect.Success<ReturnType<typeof compilePayloadCollections>>;

/** A structural copy must not substitute executable native configuration after checking. */
export const requireCompiledPayloadCollections = Effect.fn("PayloadCollections.require")(function* (compiled: CompiledPayloadCollections) {
  if (!compiledCollections.has(compiled)) return yield* Effect.fail(cmsError("unsupportedProfile"));
});
