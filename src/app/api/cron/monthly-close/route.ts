import { NextResponse } from 'next/server';
import { addMonthsToYearMonth, todayInJst, yearMonthOf } from '@/domain/date';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { closeMonth } from '@/server/services/monthlyCloseService';

/**
 * 月次締めジョブ (Vercel Cron から毎月1日に呼ぶ想定)。
 * 前月を対象に全コーチの評価を確定する。
 *
 * サービスロールで実行するため、認証は共有シークレットで行う。
 * Vercel Cron は GET で呼び出すため、手動実行用の POST と同じ処理を共有する。
 */
async function handle(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedMonth = url.searchParams.get('yearMonth');
  const targetMonth = requestedMonth ?? addMonthsToYearMonth(yearMonthOf(todayInJst()), -1);

  try {
    const supabase = createSupabaseServiceClient();
    const results = await closeMonth(supabase, targetMonth);
    return NextResponse.json({
      yearMonth: targetMonth,
      closed: results.length,
      updated: results.filter((r) => !r.skipped).length,
      candidates: results.filter(
        (r) => r.promotionStatus === 'CANDIDATE' || r.promotionStatus === 'CANDIDATE_REQUIRES_APPROVAL',
      ).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '月次締めに失敗しました' },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
