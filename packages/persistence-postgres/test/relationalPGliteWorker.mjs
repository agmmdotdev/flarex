import { parentPort } from "node:worker_threads";
import { PGlite } from "@electric-sql/pglite";

const db = await PGlite.create();
const parsers = Object.fromEntries(
  [1082, 1114, 1184, 1186, 1231, 1115, 1185, 1187, 1182].map((id) => [
    id,
    (value) => value,
  ]),
);
let tail = Promise.resolve();
parentPort.on("message", (message) => {
  tail = tail.then(async () => {
    try {
      const value =
        message.method === "exec"
          ? await db.exec(message.query)
          : await db.query(message.query, message.params, {
              parsers,
              ...(message.rowMode === undefined
                ? {}
                : { rowMode: message.rowMode }),
            });
      parentPort.postMessage({ id: message.id, ok: true, value });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        ok: false,
        error: { message: error.message, code: error.code },
      });
    }
  });
});
