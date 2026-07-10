export interface ExecutorDatabaseClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
}

export interface ExecutorWorkerEnv {
  readonly HYPERDRIVE_CACHE_DISABLED?: Pick<Hyperdrive, "connectionString">;
  readonly FLAREX_EXECUTOR_TOKEN?: string;
}

export type ExecutorRequestHandler = (request: Request) => Promise<Response>;

export interface ExecutorHandlerFactoryInput<
  Client extends ExecutorDatabaseClient,
> {
  readonly client: Client;
  readonly capabilityToken: string;
}

export interface ExecutorCleanupErrorInput {
  readonly primaryError: unknown;
  readonly cleanupError: unknown;
}

export interface RequestScopedExecutorWorkerDependencies<
  Client extends ExecutorDatabaseClient,
> {
  createClient(connectionString: string): Client;
  createHandler(
    input: ExecutorHandlerFactoryInput<Client>,
  ): ExecutorRequestHandler;
  onCleanupError?(input: ExecutorCleanupErrorInput): void | Promise<void>;
}

export interface ExecutorWorker {
  fetch(request: Request, env: ExecutorWorkerEnv): Promise<Response>;
}

export class HostedExecutorMissingCapabilityTokenError extends Error {
  constructor() {
    super("FLAREX_EXECUTOR_TOKEN is required for hosted executor requests.");
    this.name = "HostedExecutorMissingCapabilityTokenError";
  }
}

export class HostedExecutorMissingHyperdriveError extends Error {
  constructor() {
    super(
      "HYPERDRIVE_CACHE_DISABLED with a connection string is required for hosted executor requests.",
    );
    this.name = "HostedExecutorMissingHyperdriveError";
  }
}

export class HostedExecutorErrorResponse extends Error {
  constructor(readonly status: number) {
    super(`Flarex executor request returned HTTP ${status}.`);
    this.name = "HostedExecutorErrorResponse";
  }
}

type PrimaryFailure =
  | { readonly failed: false }
  | { readonly failed: true; readonly error: unknown };

export function createRequestScopedExecutorWorker<
  Client extends ExecutorDatabaseClient,
>(
  dependencies: RequestScopedExecutorWorkerDependencies<Client>,
): ExecutorWorker {
  return {
    fetch: async (request, env) => {
      const capabilityToken = env.FLAREX_EXECUTOR_TOKEN;
      if (!hasConfiguredValue(capabilityToken)) {
        return configurationErrorResponse(
          new HostedExecutorMissingCapabilityTokenError(),
        );
      }
      if (!hasBearerCapability(request, capabilityToken)) {
        return unauthorizedResponse();
      }

      const connectionString =
        env.HYPERDRIVE_CACHE_DISABLED?.connectionString;
      if (!hasConfiguredValue(connectionString)) {
        return configurationErrorResponse(
          new HostedExecutorMissingHyperdriveError(),
        );
      }

      let client: Client | undefined;
      let primaryFailure: PrimaryFailure = { failed: false };
      try {
        client = dependencies.createClient(connectionString);
        await client.connect();
        const handler = dependencies.createHandler({
          client,
          capabilityToken,
        });
        const response = await handler(request);
        if (!response.ok) {
          primaryFailure = {
            failed: true,
            error: new HostedExecutorErrorResponse(response.status),
          };
        }
        return response;
      } catch (error) {
        primaryFailure = { failed: true, error };
        throw error;
      } finally {
        if (client !== undefined) {
          try {
            await client.end();
          } catch (cleanupError) {
            if (!primaryFailure.failed) throw cleanupError;
            await reportSecondaryCleanupError(dependencies, {
              primaryError: primaryFailure.error,
              cleanupError,
            });
          }
        }
      }
    },
  } satisfies ExecutorWorker;
}

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function hasBearerCapability(
  request: Request,
  capabilityToken: string,
): boolean {
  return request.headers.get("authorization") === `Bearer ${capabilityToken}`;
}

function unauthorizedResponse(): Response {
  return Response.json(
    {
      error: "unauthorized",
      message: "Unauthorized Flarex executor request.",
    },
    { status: 401 },
  );
}

function configurationErrorResponse(error: Error): Response {
  return Response.json(
    {
      error: "executor_misconfigured",
      message: error.message,
    },
    { status: 500 },
  );
}

async function reportSecondaryCleanupError<Client extends ExecutorDatabaseClient>(
  dependencies: RequestScopedExecutorWorkerDependencies<Client>,
  input: ExecutorCleanupErrorInput,
): Promise<void> {
  try {
    await dependencies.onCleanupError?.(input);
  } catch {
    // Cleanup reporting is best effort and must never replace the primary error.
  }
}
