import type { Json } from "./types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(value: Json | object, init?: ResponseInit): Response {
  return Response.json(value, init);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, { status: error.status });
  }
  return json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

export function required(value: string | undefined, name: string): string {
  if (!value) throw new HttpError(400, `Missing ${name}.`);
  return value;
}
