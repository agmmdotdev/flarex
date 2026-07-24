export class WorkerEntrypoint<Env> {
  protected readonly env: Env;

  constructor(_ctx: ExecutionContext, env: Env) {
    this.env = env;
  }
}
