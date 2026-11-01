export class RpcTarget {}

/** Node can construct exported classes; actual DO behavior is tested in Workerd. */
export class DurableObject<Env> {
  constructor(protected readonly ctx: DurableObjectState, protected readonly env: Env) {}
}
