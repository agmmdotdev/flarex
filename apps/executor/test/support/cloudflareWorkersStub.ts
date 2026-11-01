export class RpcTarget {}

/** Node-side module construction only; actual DO behavior is proved in Workerd. */
export class DurableObject<Env> {
  constructor(protected readonly ctx: DurableObjectState, protected readonly env: Env) {}
}
