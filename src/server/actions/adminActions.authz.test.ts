/**
 * 「COACH は設定変更の権限を一切持たない」を Server Action の層で保証する。
 *
 * DB (RLS + 拒否トリガ) で止まるとしても、アプリ側でも必ず止める。
 * ここでは COACH のセッションを差し込んだうえで管理系のアクションを全て呼び、
 *   ・成功しないこと
 *   ・拒否の理由が「管理者のみ」であること
 * を確認する。新しい管理アクションを足したときに、
 * ガードを付け忘れるとこのテストが落ちる。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 本番の環境変数に依存せずに読み込めるようにする (アクションはガードで止まるため実接続しない)
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

const coachSession = {
  user: { id: 'user-coach', name: 'コーチ', email: 'coach@example.test', role: 'COACH', active: true },
  coach: {
    id: 'coach-1',
    user_id: 'user-coach',
    professional_level: 'P1',
    lesson_unit_price: 5000,
    hire_date: '2025-01-01',
    left_on: null,
  },
};

const getSessionContext = vi.fn();

vi.mock('@/server/auth', () => ({
  getSessionContext: () => getSessionContext(),
  requireAdmin: () => {
    throw new Error('ページ用のガードが Server Action から呼ばれています');
  },
  requireCoach: () => {
    throw new Error('ページ用のガードが Server Action から呼ばれています');
  },
  requireSession: () => {
    throw new Error('ページ用のガードが Server Action から呼ばれています');
  },
}));

// Server Action からの Cookie 書き込み・再検証は、この層のテストでは不要
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => undefined }),
}));

/** ガードを通過してしまった場合に、そこから先で実接続しないよう握りつぶす */
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => {
    throw new Error('COACH のセッションで Supabase へ到達しました (ガードが効いていません)');
  },
  createSupabaseServiceClient: () => {
    throw new Error('COACH のセッションでサービスロールへ到達しました (ガードが効いていません)');
  },
}));

const { ADMIN_ONLY_MESSAGE } = await import('@/server/authz');
const actions = await import('./adminActions');

/** 管理系アクションと、通過してしまったときに変更される設定 */
const ADMIN_ACTIONS: { label: string; run: () => Promise<unknown> }[] = [
  { label: '顧客の新規登録', run: () => actions.createCustomerAction(null, form({ name: 'x' })) },
  { label: '目標の承認', run: () => actions.decideGoalAction(null, form({ customerId: id(), decision: 'APPROVE' })) },
  {
    label: '顧客ステータスの変更',
    run: () => actions.updateCustomerStatusAction(null, form({ customerId: id(), status: 'CANCELLED' })),
  },
  { label: '担当コーチの変更', run: () => actions.reassignCoachAction(null, form({ customerId: id(), coachId: id() })) },
  {
    label: '行動ルールの設定',
    run: () => actions.setBehaviorStatusAction(null, form({ coachId: id(), yearMonth: '2026-06', status: 'OK' })),
  },
  {
    label: '昇格要件の承認',
    run: () =>
      actions.setRequirementCheckAction(null, form({ coachId: id(), requirementCode: 'X', achievedCount: '99' })),
  },
  {
    label: '昇格の決定',
    run: () => actions.decidePromotionAction(null, form({ coachId: id(), yearMonth: '2026-06', decision: 'APPROVE' })),
  },
  {
    label: '商品・インセンティブの登録',
    run: () =>
      actions.upsertProductAction(
        null,
        form({ code: 'X', name: 'x', defaultPrice: '1', incentiveAmount: '999999' }),
      ),
  },
  {
    label: '評価ルールの新バージョン作成',
    run: () => actions.createRulesVersionAction(null, form({ effectiveFrom: '2030-01-01', rules: '{}' })),
  },
  { label: '月次締めの実行', run: () => actions.closeMonthAction(null, form({ yearMonth: '2026-06' })) },
  {
    label: '売上の取消・返金',
    run: () => actions.updateSaleStatusAction(null, form({ saleId: id(), mode: 'CANCELLED' })),
  },
  { label: '成果記録の取消', run: () => actions.deletePerformanceRecordAction(null, form({ recordId: id(), customerId: id() })) },
  {
    label: 'コーチの新規登録',
    run: () => actions.createCoachAction(null, form({ name: 'x', email: 'x@example.test', level: 'P1' })),
  },
  {
    label: 'コーチのランク・単価の変更',
    run: () => actions.updateCoachAction(null, form({ coachId: id(), level: 'P4', lessonUnitPrice: '999999' })),
  },
];

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

function id(): string {
  return '00000000-0000-0000-0000-000000000001';
}

describe('COACH は管理系の Server Action を実行できない', () => {
  beforeEach(() => {
    getSessionContext.mockReset();
    getSessionContext.mockResolvedValue(coachSession);
  });

  it('管理系アクションを網羅している (追加時の付け忘れ防止)', () => {
    const exported = Object.keys(actions).filter((name) => name.endsWith('Action'));
    expect(ADMIN_ACTIONS).toHaveLength(exported.length);
  });

  for (const { label, run } of ADMIN_ACTIONS) {
    it(`拒否される: ${label}`, async () => {
      const result = (await run()) as { ok: boolean; error?: string };
      expect(result.ok, `${label} が COACH に許可されています`).toBe(false);
      expect(result.error).toBe(ADMIN_ONLY_MESSAGE);
    });
  }

  it('未ログインでも拒否される', async () => {
    getSessionContext.mockResolvedValue(null);
    const result = (await actions.upsertProductAction(
      null,
      form({ code: 'X', name: 'x', defaultPrice: '1', incentiveAmount: '1' }),
    )) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).not.toBe(ADMIN_ONLY_MESSAGE);
  });

  it('ADMIN なら権限チェックを通過する (締めすぎていないことの確認)', async () => {
    getSessionContext.mockResolvedValue({
      user: { ...coachSession.user, role: 'ADMIN' },
      coach: null,
    });
    // ガードを抜けた先で Supabase へ触ろうとして落ちる = 権限判定は通過した
    await expect(
      actions.upsertProductAction(null, form({ code: 'X', name: 'x', defaultPrice: '1', incentiveAmount: '1' })),
    ).rejects.toThrow(/ガードが効いていません/);
  });
});
