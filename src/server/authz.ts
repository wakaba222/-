/**
 * 権限判定を1箇所に集める。
 *
 * 本システムの決まり: **COACH は設定変更の権限を一切持たない。**
 * 設定 (評価ルール / 商品・インセンティブ / コーチのランク・レッスン単価 /
 * 行動ルール / 昇格審査・昇格要件 / 評価スナップショット / ユーザーのロール) の
 * 変更は ADMIN だけが行える。
 *
 * 防御は3層で行い、どれか1つが破れても他が止める:
 *   1. DB     … RLS のポリシー + 設定系テーブルの拒否トリガ (migration 0011)
 *   2. サーバー … このファイルのガードを Server Action の先頭で必ず通す
 *   3. API    … Route Handler も同じガードを通す
 * 画面に出さないこと (UI) は利便性のためであって、権限の担保ではない。
 */
import { NextResponse } from 'next/server';
import { getSessionContext, type SessionContext } from '@/server/auth';
import { fail, type ActionResult } from '@/server/actionResult';

export const ADMIN_ONLY_MESSAGE = 'この操作は管理者のみ実行できます';
const UNAUTHENTICATED_MESSAGE = 'ログインし直してください';

export type AdminGuard =
  | { ok: true; session: SessionContext }
  | { ok: false; result: ActionResult<never> };

/**
 * Server Action 用の ADMIN ガード。
 *
 * ページ側の requireAdmin() は redirect() で画面を移すが、
 * redirect() は例外として投げられるため、呼び出し側が try/catch で
 * 握りつぶすと素通りしてしまう。書き込み処理では事故が致命的になるので、
 * ここでは例外を使わず「拒否」を値として返す。
 *
 *   const guard = await requireAdminForAction();
 *   if (!guard.ok) return guard.result;
 */
export async function requireAdminForAction(): Promise<AdminGuard> {
  const session = await getSessionContext();
  if (!session) return { ok: false, result: fail(UNAUTHENTICATED_MESSAGE) };
  if (session.user.role !== 'ADMIN') return { ok: false, result: fail(ADMIN_ONLY_MESSAGE) };
  return { ok: true, session };
}

/**
 * Route Handler 用の ADMIN ガード。
 * 拒否時は 401 / 403 の NextResponse を返す (本文に理由を含める)。
 */
export async function requireAdminForRoute(): Promise<
  { ok: true; session: SessionContext } | { ok: false; response: NextResponse }
> {
  const session = await getSessionContext();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: UNAUTHENTICATED_MESSAGE }, { status: 401 }) };
  }
  if (session.user.role !== 'ADMIN') {
    return { ok: false, response: NextResponse.json({ error: ADMIN_ONLY_MESSAGE }, { status: 403 }) };
  }
  return { ok: true, session };
}

/** COACH に見せてよい設定変更UIは無い。画面側の分岐で使う */
export function canEditSettings(session: SessionContext | null): boolean {
  return session?.user.role === 'ADMIN';
}
