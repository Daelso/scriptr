export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json({ ok: true, data }, init);
}

export function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  return (await req.json()) as T;
}
