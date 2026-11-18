import { Effect } from "effect";
import type { CompiledPayloadCollections } from "../collections";
import { makePayloadNative } from "../runtime/native";
import { bindPayloadDirect } from "../direct/binding";
import { registerPayloadRuntime } from "../runtime/registry";

type Probe = "none" | "unobserved" | "wrong-collection" | "foreign-request" |
  "cross-write" | "unbound" | "projection" | "locale";

/** Fixed authenticated-loader refusal probes; no caller-supplied native callback. */
export const makePayloadAccessProbeRuntime = Effect.fn("PayloadAccessProbe.make")(function* (
  compiled: CompiledPayloadCollections,
  target: Readonly<{ collection: string; observedId: string; unobservedId: string }>,
) {
  let probe: Probe = "none";
  const native = yield* makePayloadNative(compiled, {
    onExecute: () => {}, onCollection: () => {}, hooks: {
      afterRead: [async ({ doc, req, collection }) => {
        if (collection.slug !== "articles" || probe === "none") return doc;
        if (probe === "cross-write") await req.payload.db.create({ collection: target.collection,
          data: { name: "forged" }, req });
        else await req.payload.db.find({
          collection: probe === "wrong-collection" ? "articles" :
            probe === "unbound" ? "payload-preferences" : target.collection,
          req: probe === "foreign-request" ? { ...req } : req,
          ...(probe === "projection" ? { select: { name: true } } : {}),
          ...(probe === "locale" ? { locale: "en" } : {}),
          where: { id: { in: [probe === "unobserved" ? target.unobservedId : target.observedId] } },
          pagination: false, limit: 0, page: 1, sort: "id",
        });
        return doc;
      }],
    },
  });
  const runtime = Object.freeze(bindPayloadDirect(native));
  registerPayloadRuntime(runtime, native);
  return { runtime,
    selectProbe: (selected: Probe) => { probe = selected; } };
});
