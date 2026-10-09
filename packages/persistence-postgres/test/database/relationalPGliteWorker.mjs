import { parentPort, workerData } from "node:worker_threads";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gin } from "@electric-sql/pglite/contrib/btree_gin";

const extensions = { pg_trgm, btree_gin };
const startup = { extensions, ...(workerData?.transport === "finiteCapture"
  ? { startParams: [...PGlite.defaultStartParams, "-c", "statement_timeout=30000"] } : {}) };
let db = workerData?.dataDir === undefined
  ? await PGlite.create(startup)
  : await PGlite.create(workerData.dataDir, startup);
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
      if (message.method === "reopen") {
        if (typeof workerData?.dataDir !== "string") throw new Error("Reopen requires persisted fixture data");
        await db.close();
        db = await PGlite.create(workerData.dataDir, startup);
        parentPort.postMessage({ id: message.id, ok: true, value: null });
        return;
      }
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
        error: { message: error.message, code: error.code, detail: error.detail },
      });
    }
  });
});
