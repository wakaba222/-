import type { ActionResult } from '@/server/actionResult';

/** Server Action の結果表示。成功・失敗のどちらも必ず理由を出す */
export function FormMessage({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;

  const isError = !state.ok;
  return (
    <p
      role="status"
      aria-live="polite"
      className={
        isError
          ? 'rounded-xl border border-danger-100 bg-danger-100 px-3 py-2 text-sm text-danger-600'
          : 'rounded-xl border border-eagle-100 bg-eagle-50 px-3 py-2 text-sm text-eagle-800'
      }
    >
      {state.ok ? state.message : state.error}
    </p>
  );
}
