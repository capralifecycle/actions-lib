/**
 * The outcome of an operation that is expected to fail on some inputs, carried
 * as a value so a pure function can report a reason without throwing.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })

export const err = <T>(error: string): Result<T> => ({ ok: false, error })
