import type { z } from "zod";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & { fetchFn?: typeof fetch; token?: string } = {},
): Promise<T> {
  const { fetchFn = fetch, token, ...rest } = init;
  const res = await fetchFn(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} on ${path}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "invalid response body");
  }
  return schema.parse(body);
}
