export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json({ ok: true, data }, init);
}

export function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

export class JsonParseError extends Error {
  constructor(message = "invalid JSON body") {
    super(message);
    this.name = "JsonParseError";
  }
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof TypeError) {
      throw new JsonParseError();
    }
    throw err;
  }
}
