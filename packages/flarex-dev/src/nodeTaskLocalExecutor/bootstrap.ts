/**
 * Embedded bootstrap for the N5 trusted-fixture process. User modules execute
 * in a separate vm context; this host alone owns stdio and callback material.
 */
export const LOCAL_NODE_TASK_BOOTSTRAP = String.raw`
import vm from "node:vm";
import path from "node:path";
import { deserialize, serialize } from "node:v8";

const encode = value => serialize(value).toString("base64");
const decode = text => {
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) {
    throw new Error("Invalid Local Node Task wire frame encoding.");
  }
  return deserialize(bytes);
};
const send = message => process.stdout.write(encode(message) + "\n");

let buffer = "";
const messages = [];
const waiters = [];
const enqueue = message => {
  const waiter = waiters.shift();
  if (waiter === undefined) messages.push(message);
  else waiter(message);
};
const receive = () => messages.length > 0
  ? Promise.resolve(messages.shift())
  : new Promise(resolve => waiters.push(resolve));
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) enqueue(decode(line));
  }
});

send({
  type: "hello",
  nodeRuntimeAbiIdentity:
    "nodejs-" + process.versions.node.split(".")[0] + "-" +
    process.platform + "-" + process.arch,
});
const init = await receive();
if (init?.type !== "init") throw new Error("Expected init frame.");
const sources = new Map(init.modules.map(module => [module.path, module.source]));
const context = vm.createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
  name: "flarex-node-task-trusted-fixture",
});
const modules = new Map();
const load = modulePath => {
  const existing = modules.get(modulePath);
  if (existing !== undefined) return existing;
  const source = sources.get(modulePath);
  if (source === undefined) throw new Error("Module is absent from the bundle.");
  const loaded = new vm.SourceTextModule(source, {
    context,
    identifier: modulePath,
    importModuleDynamically: () => {
      throw new Error("Dynamic imports are denied.");
    },
  });
  modules.set(modulePath, loaded);
  return loaded;
};
const resolve = (specifier, referencingModule) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    throw new Error("Package and built-in imports are denied.");
  }
  const resolved = path.posix.normalize(path.posix.join(
    path.posix.dirname(referencingModule.identifier),
    specifier,
  ));
  if (!sources.has(resolved)) throw new Error("Imported module is absent.");
  return load(resolved);
};
const evaluateEntry = async modulePath => {
  const module = load(modulePath);
  if (module.status === "unlinked") await module.link(resolve);
  if (module.status === "linked") await module.evaluate();
  if (module.status === "errored") throw module.error;
  return module;
};
await evaluateEntry(init.executionPath);
const entry = await evaluateEntry(init.entryPath);
const handler = entry.namespace[init.exportName];
if (typeof handler !== "function") throw new Error("Task export is not callable.");
send({ type: "ready" });

const attachment = await receive();
if (attachment?.type !== "attach") throw new Error("Expected attach frame.");
send({ type: "attached", attachmentId: attachment.attachmentId });
let nextCallbackId = 1;
let nextMutationOrdinal = 1n;
const pending = new Map();
const callback = (operation, functionPath, argumentsValue, ordinal) => {
  const id = nextCallbackId++;
  const frame = { type: "callback", id, operation, functionPath, argumentsValue,
    ...(ordinal === undefined ? {} : { ordinal }) };
  return new Promise((resolve, reject) => {
    let timer;
    const transmit = () => {
      send(frame);
      timer = setTimeout(transmit, 75);
    };
    pending.set(id, { resolve, reject, clear: () => clearTimeout(timer) });
    transmit();
  });
};
const ctx = Object.freeze({
  runQuery: (functionPath, argumentsValue) =>
    callback("runQuery", functionPath, argumentsValue),
  runMutation: (functionPath, argumentsValue) => {
    const ordinal = nextMutationOrdinal++;
    return callback("runMutation", functionPath, argumentsValue, ordinal);
  },
});
void (async () => {
  try {
    const value = await handler(ctx, init.input);
    try {
      send({ type: "completed", value });
    } catch {
      send({ type: "invalidOutput" });
    }
  } catch {
    send({ type: "failed" });
  }
})();
for (;;) {
  const message = await receive();
  if (message?.type !== "callbackResult") continue;
  const waiting = pending.get(message.id);
  if (waiting === undefined) continue;
  pending.delete(message.id);
  waiting.clear();
  if (message.result?.kind === "success") waiting.resolve(message.result.value);
  else waiting.reject(new Error("Task callback failed."));
}
`;
