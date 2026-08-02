interface DisposableRpcStub {
  [Symbol.dispose](): void;
}

interface JournalTableStub extends DisposableRpcStub {
  runPointOperation(operation: unknown): Promise<unknown>;
}

interface JournalParentStub extends DisposableRpcStub {
  resolvePointTable(tableName: unknown): Promise<JournalTableStub>;
}

interface JournalProvider {
  open(id: string, scenario: string): Promise<JournalParentStub>;
  inspect(id: string): Promise<Readonly<{
    closeFinished: boolean;
    closeStarted: boolean;
    operationCalls: number;
    tableIdentityPreserved: boolean;
  }>>;
  finishClose(id: string): Promise<unknown>;
}

interface Env {
  readonly JOURNAL: JournalProvider;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    switch (path) {
      case "/success":
        return Response.json(await successScenario(env));
      case "/result-rejected":
        return Response.json(await resultRejectedScenario(env));
      case "/failure":
        return Response.json(await failureScenario(env));
      case "/validation-failure":
        return Response.json(await validationFailureScenario(env));
      case "/validation-lookalike":
        return Response.json(await validationLookalikeScenario(env));
      case "/late":
        return Response.json(await lateScenario(env));
      case "/drain":
        return Response.json(await drainScenario(env));
      case "/ordering":
        return Response.json(await orderingScenario(env));
      case "/defect":
        return Response.json(await terminalCauseScenario(env, "defect"));
      case "/interruption":
        return Response.json(
          await terminalCauseScenario(env, "interruption"),
        );
      default:
        return new Response("not found", { status: 404 });
    }
  },
};

async function successScenario(env: Env) {
  const parent = await env.JOURNAL.open("success", "success");
  const table = await parent.resolvePointTable("orders");
  const result = await table.runPointOperation({ id: "success" });
  const disposal = {
    parent: typeof parent[Symbol.dispose],
    table: typeof table[Symbol.dispose],
  };
  table[Symbol.dispose]();
  const disposedChild = await rejectionReceipt(
    table.runPointOperation({ id: "after-dispose" }),
  );
  parent[Symbol.dispose]();
  return {
    disposal,
    disposedChild: disposedChild.rejected,
    result,
    state: await env.JOURNAL.inspect("success"),
  };
}

async function resultRejectedScenario(env: Env) {
  return Promise.all(
    ["rejected", "sequenceRejected", "stateRejected"].map(
      async (resultKind) => {
        const id = `result-${resultKind}`;
        const parent = await env.JOURNAL.open(id, "resultRejected");
        const table = await parent.resolvePointTable("orders");
        const remote = await rejectionReceipt(
          table.runPointOperation({ id: resultKind }),
        );
        const local = await env.JOURNAL.finishClose(id);
        table[Symbol.dispose]();
        parent[Symbol.dispose]();
        return { local, remote };
      },
    ),
  );
}

async function failureScenario(env: Env) {
  const parent = await env.JOURNAL.open("failure", "operationFailure");
  const table = await parent.resolvePointTable("orders");
  const remote = await rejectionReceipt(
    table.runPointOperation({ id: "failure" }),
  );
  const local = await env.JOURNAL.finishClose("failure");
  const localAgain = await env.JOURNAL.finishClose("failure");
  table[Symbol.dispose]();
  parent[Symbol.dispose]();
  return { local, localAgain, remote };
}

async function validationFailureScenario(env: Env) {
  const parent = await env.JOURNAL.open(
    "validation-failure",
    "validationFailure",
  );
  const table = await parent.resolvePointTable("orders");
  const invalid = await rejectionReceipt(
    table.runPointOperation({ id: "first" }),
  );
  const valid = await table.runPointOperation({ id: "second" });
  const local = await env.JOURNAL.finishClose("validation-failure");
  const state = await env.JOURNAL.inspect("validation-failure");
  table[Symbol.dispose]();
  parent[Symbol.dispose]();
  return { invalid, valid, local, state };
}

async function validationLookalikeScenario(env: Env) {
  const parent = await env.JOURNAL.open(
    "validation-lookalike",
    "validationLookalike",
  );
  const table = await parent.resolvePointTable("orders");
  const remote = await rejectionReceipt(
    table.runPointOperation({ id: "lookalike" }),
  );
  const local = await env.JOURNAL.finishClose("validation-lookalike");
  table[Symbol.dispose]();
  parent[Symbol.dispose]();
  return { local, remote };
}

async function lateScenario(env: Env) {
  const parent = await env.JOURNAL.open("late", "success");
  const table = await parent.resolvePointTable("orders");
  const local = await env.JOURNAL.finishClose("late");
  const lateParent = await rejectionReceipt(
    parent.resolvePointTable("late-table"),
  );
  const lateChild = await rejectionReceipt(
    table.runPointOperation({ id: "late-operation" }),
  );
  const state = await env.JOURNAL.inspect("late");
  table[Symbol.dispose]();
  parent[Symbol.dispose]();
  return { lateChild, lateParent, local, state };
}

async function drainScenario(env: Env) {
  const parent = await env.JOURNAL.open("drain", "delayedSuccess");
  const table = await parent.resolvePointTable("orders");
  const gate = controlledOperationGate();
  const admitted = table.runPointOperation({
    id: "delayed",
    gate: gate.readable,
  });
  await waitForState(env.JOURNAL, "drain", state =>
    state.operationCalls === 1
  );
  const close = env.JOURNAL.finishClose("drain");
  await waitForState(env.JOURNAL, "drain", state => state.closeStarted);
  const beforeRelease = await env.JOURNAL.inspect("drain");
  const late = await rejectionReceipt(
    table.runPointOperation({ id: "late" }),
  );
  gate.release();
  const result = await admitted;
  const local = await close;
  const afterRelease = await env.JOURNAL.inspect("drain");
  table[Symbol.dispose]();
  parent[Symbol.dispose]();
  return { afterRelease, beforeRelease, late, local, result };
}

async function orderingScenario(env: Env) {
  const parent = await env.JOURNAL.open("ordering", "orderedFailures");
  const table = await parent.resolvePointTable("orders");
  const gate = controlledOperationGate();
  const first = rejectionReceipt(
    table.runPointOperation({ id: "first", gate: gate.readable }),
  );
  await waitForState(env.JOURNAL, "ordering", state =>
    state.operationCalls === 1
  );
  const second = rejectionReceipt(
    table.runPointOperation({ id: "second" }),
  );
  await waitForState(env.JOURNAL, "ordering", state =>
    state.operationCalls === 2
  );
  const close = env.JOURNAL.finishClose("ordering");
  gate.release();
  const remote = await Promise.all([first, second]);
  const local = await close;
  table[Symbol.dispose]();
  parent[Symbol.dispose]();
  return { local, remote };
}

async function terminalCauseScenario(
  env: Env,
  scenario: "defect" | "interruption",
) {
  const parent = await env.JOURNAL.open(scenario, scenario);
  const table = await parent.resolvePointTable("orders");
  const remote = await rejectionReceipt(
    table.runPointOperation({ id: scenario }),
  );
  const local = await env.JOURNAL.finishClose(scenario);
  table[Symbol.dispose]();
  parent[Symbol.dispose]();
  return { local, remote };
}

async function rejectionReceipt(promise: Promise<unknown>) {
  try {
    await promise;
    return {
      rejected: false,
      name: "",
      message: "",
      stack: "",
    };
  } catch (cause) {
    return {
      rejected: true,
      name: cause instanceof Error ? cause.name : typeof cause,
      message: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack ?? "" : "",
    };
  }
}

async function waitForState(
  provider: JournalProvider,
  id: string,
  predicate: (
    state: Readonly<{
      closeFinished: boolean;
      closeStarted: boolean;
      operationCalls: number;
      tableIdentityPreserved: boolean;
    }>,
  ) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate(await provider.inspect(id))) return;
    await new Promise(resolve => {
      setTimeout(resolve, 1);
    });
  }
  throw new Error("journal RPC test state did not advance");
}

function controlledOperationGate(): Readonly<{
  readonly readable: ReadableStream<Uint8Array>;
  readonly release: () => void;
}> {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return Object.freeze({
    readable,
    release: () => {
      if (controller === undefined) {
        throw new Error("operation gate was not initialized");
      }
      controller.close();
    },
  });
}
