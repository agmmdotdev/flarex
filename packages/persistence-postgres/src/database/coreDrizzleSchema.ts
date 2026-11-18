/** Canonical physical maintenance schema. Logical application schemas never add DDL. */
import { corePersistenceSchema } from "./schema/corePersistence";

export const coreNamespace = corePersistenceSchema.namespace;
export const documents = corePersistenceSchema.documents;
export const indexes = corePersistenceSchema.indexes;
export const leases = corePersistenceSchema.leases;
export const readOnly = corePersistenceSchema.readOnly;
export const persistenceGlobals = corePersistenceSchema.persistenceGlobals;
