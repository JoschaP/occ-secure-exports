// Normalizes errors caught from `invoke()` calls. The Rust core serializes its
// errors as `{ code, message }` (see src-tauri/src/error.rs); this module reads
// that shape robustly and degrades gracefully for plain strings or `Error`s
// (e.g. thrown by the Tauri runtime itself), so callers never have to match on
// message text.

/** Structured error shape emitted by the Rust core (serialized `AppError`). */
export interface AppErr {
  code: string;
  message: string;
}

function isAppErr(e: unknown): e is AppErr {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "message" in e &&
    typeof (e as AppErr).message === "string" &&
    typeof (e as AppErr).code === "string"
  );
}

/** Human-readable message for any caught value (AppErr, Error, or string). */
export function errText(e: unknown): string {
  if (isAppErr(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** The core's machine-readable code, or undefined for non-core errors. Kept in
 *  sync with `AppError::code()` in the Rust core. */
export function errCode(e: unknown): string | undefined {
  return isAppErr(e) ? e.code : undefined;
}
