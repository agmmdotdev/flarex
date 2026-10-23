import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { AppDocumentIdV1Schema } from "flarex-protocol/app-document-id";
import { bindPrivatePayloadSave, preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { preparePrivateReverseReadPolicy } from "./privatePayloadReverseReadCommands";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

const productResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const articleResult = Schema.decodeUnknownSync(Schema.Struct({ id: AppDocumentIdV1Schema }));

export async function privatePayloadReverseSeed(fixture: PrivatePayloadSaveFixture, name: string, size = 3, productId?: string) {
  const product = productResult(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: name, handle: name, ...(productId === undefined ? {} : { id: productId }) })));
  const savePolicy = await preparePrivateSavePolicy(fixture, { source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id] });
  await savePolicy.root.publish();
  const root = await fixture.open(), save = await bindPrivatePayloadSave(fixture, root, savePolicy.documentId);
  const ids: typeof AppDocumentIdV1Schema.Type[] = [];
  try {
    for (let i = 0; i < size; i++) {
      const result = await Effect.runPromise(save.invoke("create", { collection: "posts", data: { title: `${name} ${i}`, featuredProduct: product.id } }));
      if (result.kind !== "completed") throw new Error("Native reverse-read seed refused");
      ids.push(articleResult(result.result).id);
    }
    expect(await root.publish(null, [root.payloadProfile(save.selected.profileRevision)])).toMatchObject({ kind: "published" });
  } finally { await save.close(); }
  const policy = await preparePrivateReverseReadPolicy(fixture, { enumerate: [product.id], articles: ids });
  await policy.root.publish();
  return { productId: product.id, ids, savePolicyId: savePolicy.documentId, policyId: policy.documentId, principal: policy.root.principal };
}
