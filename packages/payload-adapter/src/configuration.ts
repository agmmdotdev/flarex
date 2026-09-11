import { buildConfig, type CollectionConfig } from "payload";
import { Effect } from "effect";
import { cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { makePayloadDatabaseAdapter } from "./adapter";

/** Caller supplies owned collections: native sanitation mutates their fields. */
export const buildPayloadConfiguration = Effect.fn("PayloadAdapter.buildConfiguration")((
  collections: CollectionConfig[], bridge: Pick<ReturnType<typeof makePayloadDatabaseAdapter>, "adapter" | "unsupported">,
) => Effect.tryPromise({
  try: () => buildConfig({
    secret: "private-payload-conformance-only-not-a-deployment-secret", db: bridge.adapter,
    collections: [...collections, { slug: "users", auth: true, lockDocuments: false, fields: [] }],
    admin: { user: "users", disable: true }, globals: [], folders: false,
    jobs: { tasks: [], workflows: [] }, telemetry: false, typescript: { autoGenerate: false },
    kv: { init: () => ({ clear: bridge.unsupported, delete: bridge.unsupported, get: bridge.unsupported,
      has: bridge.unsupported, keys: bridge.unsupported, set: bridge.unsupported }) },
    email: () => ({ name: "disabled", defaultFromAddress: "disabled@example.invalid", defaultFromName: "Disabled",
      sendEmail: () => bridge.unsupported("email") }),
  }),
  catch: cause => cmsError("unsupportedProfile", cause),
}));
