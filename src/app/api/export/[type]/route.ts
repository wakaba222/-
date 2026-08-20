import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSessionContext } from '@/server/auth';
import { buildAdminCoachRows } from '@/server/services/adminOverviewService';
import { buildCustomerViews, CUSTOMER_VIEW_COLUMNS } from '@/server/services/customerViewService';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { currentYearMonth } from '@/server/services/evaluationService';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import type { CustomerRow, SaleRow } from '@/lib/supabase/types';

type ExportType = 'coaches' | 'customers' | 'sales';

/** Excel で開いたときに日本語が化けないよう BOM を付ける */
const BOM = '﻿';

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return BOM + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  const session = await getSessionContext();
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const { type } = await params;
  const supabase = await createSupabaseServerClient();
  const yearMonth = currentYearMonth();

  let csv: string;
  switch (type as ExportType) {
    case 'coaches': {
      const rows = await buildAdminCoachRows(supabase, yearMonth);
      csv = toCsv(
        ['コーチ名', 'ランク', 'Professional Score', '区分', '顧客成果点', '完全成果率', '短期成果率', '今月売上', '3ヶ月売上', '年間売上', '担当顧客数', '評価対象数', '完全達成数', '昇格status', '行動ルール'],
        rows.map((row) => [
          row.name,
          row.level,
          row.professionalScore,
          row.scoreBand,
          row.customerSuccessScore,
          row.longTermRate,
          row.shortTermRate,
          row.monthlySales,
          row.quarterlySales,
          row.annualSales,
          row.customerCount,
          row.eligibleCount,
          row.achievedCount,
          row.promotionStatus,
          row.behaviorStatus,
        ]),
      );
      break;
    }
    case 'customers': {
      const [{ data }, rules, coaches] = await Promise.all([
        supabase.from('customers').select(CUSTOMER_VIEW_COLUMNS).is('deleted_at', null).returns<CustomerRow[]>(),
        loadEvaluationRules(supabase, { yearMonth }),
        loadAdminCoaches(supabase),
      ]);
      const coachNames = new Map(coaches.map((c) => [c.id, c.users?.name ?? '']));
      const views = buildCustomerViews(data ?? [], rules, coachNames);
      csv = toCsv(
        ['顧客名', '担当コーチ', '開始日', '経過月数', 'ステータス', '目標', '現在成果', '評価対象', '完全達成', '達成日', '最終更新'],
        views.map((view) => [
          view.name,
          view.coachName,
          view.programStartDate,
          view.elapsedMonths,
          view.status,
          view.goalLabel,
          view.latestLabel,
          view.isEligible ? '対象' : '対象外',
          view.completeSuccess ? '達成' : '未達',
          view.completeSuccessAt,
          view.updatedAt.slice(0, 10),
        ]),
      );
      break;
    }
    case 'sales': {
      const [{ data }, coaches] = await Promise.all([
        supabase
          .from('sales')
          .select('id, coach_id, customer_id, product_id, sold_on, amount, incentive_amount, acquisition_source, status, refund_amount, note, products(id, name, code, is_sales_score_target), customers(id, name)')
          .is('deleted_at', null)
          .order('sold_on', { ascending: false })
          .returns<SaleRow[]>(),
        loadAdminCoaches(supabase),
      ]);
      const coachNames = new Map(coaches.map((c) => [c.id, c.users?.name ?? '']));
      csv = toCsv(
        ['成約日', 'コーチ', '顧客', '商品', '金額', '返金額', 'インセンティブ', '獲得経路', '状態', '評価対象商品'],
        (data ?? []).map((sale) => [
          sale.sold_on,
          coachNames.get(sale.coach_id) ?? '',
          sale.customers?.name ?? '',
          sale.products?.name ?? '',
          sale.amount,
          sale.refund_amount,
          sale.incentive_amount,
          sale.acquisition_source,
          sale.status,
          sale.products?.is_sales_score_target ? '対象' : '対象外',
        ]),
      );
      break;
    }
    default:
      return NextResponse.json({ error: '不明な出力種別です' }, { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="eagle-${type}-${yearMonth}.csv"`,
    },
  });
}
