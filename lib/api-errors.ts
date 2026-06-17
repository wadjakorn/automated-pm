import { NextResponse } from "next/server";

// Consistent JSON error shapes so both the UI and the CLI can parse them.
export class ApiError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    extra?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (what = "resource") =>
  new ApiError(404, "not_found", `${what} not found`);

export const badRequest = (message: string) =>
  new ApiError(400, "bad_request", message);

// Illegal state-machine move.
export const illegalTransition = (reason: string) =>
  new ApiError(422, "illegal_transition", reason);

// Optimistic-lock failure. `current` is the fresh row so the client can reconcile.
export const conflict = (current: unknown) =>
  new ApiError(409, "conflict", "Version mismatch; row changed elsewhere", {
    current,
  });

// Wrap a route handler so thrown ApiErrors become clean JSON responses.
export function handle(
  fn: () => Promise<unknown> | unknown
): Promise<NextResponse> {
  return Promise.resolve()
    .then(fn)
    .then((data) => NextResponse.json(data ?? { ok: true }))
    .catch((err) => {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.code, message: err.message, ...(err.extra ?? {}) },
          { status: err.status }
        );
      }
      console.error("Unhandled API error:", err);
      return NextResponse.json(
        { error: "internal", message: String(err?.message ?? err) },
        { status: 500 }
      );
    });
}
