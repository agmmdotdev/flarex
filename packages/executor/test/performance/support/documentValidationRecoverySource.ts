import { APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1 } from "flarex-protocol/internal/application-revision-syscall-validation-v1";

/** The same authored application witnesses genuine point rejection recovery
 * through both test transports while retaining the native Product operations. */
export function documentValidationRecoverySource(seed: Readonly<{
  updateInput: unknown; retrieveInput: unknown; listInput: unknown;
}>) {
  return `export default { users: { create: { isMutation: true, isPublic: true,
    _handler: async ctx => {
      const earlierId = await ctx.db.insert("users", { name: "earlier accepted" });
      let caughtDocumentValidation = false;
      try { await ctx.db.insert("users", { name: 123 }); }
      catch (cause) { caughtDocumentValidation = cause.name === ${JSON.stringify(APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1)}; }
      if (!caughtDocumentValidation) throw new Error("Expected genuine document validator rejection");
      const id = await ctx.db.insert("users", { name: "before" });
      const updated = await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
      const pending = await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(seed.retrieveInput)});
      const listed = await ctx.privateMixed.call("medusa.product", "listByHandle", ${JSON.stringify(seed.listInput)});
      await ctx.db.patch(id, { name: pending.title });
      const earlier = await ctx.db.get(earlierId);
      const later = await ctx.db.get(id);
      return { id, updated, pending, listed, caughtDocumentValidation, earlier, later };
    } } } };`;
}
