/** Server Action の戻り値。例外を投げずに画面へ理由を返す */
export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string };

export function ok<T>(message: string, data?: T): ActionResult<T> {
  return { ok: true, message, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

export const INITIAL_ACTION_STATE: ActionResult | null = null;
