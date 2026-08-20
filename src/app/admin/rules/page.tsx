import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { currentYearMonth } from '@/server/services/evaluationService';
import { formatDate } from '@/lib/format';
import type { EvaluationRuleRow } from '@/lib/supabase/types';
import { RulesForm } from './RulesForm';

export default async function EvaluationRulesPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: versions }, activeRules] = await Promise.all([
    supabase
      .from('evaluation_rules')
      .select('version, effective_from, effective_to, rules, note')
      .order('version', { ascending: false })
      .returns<EvaluationRuleRow[]>(),
    loadEvaluationRules(supabase, { yearMonth: currentYearMonth() }),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="評価ルール"
          description="閾値・配点・昇格基準はここで管理します。過去の評価は当時のversionのまま保持されます"
        />
        <CardBody className="py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-500">
                <th className="py-2 pr-3 font-medium">version</th>
                <th className="py-2 pr-3 font-medium">適用開始</th>
                <th className="py-2 font-medium">メモ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(versions ?? []).map((row) => (
                <tr key={row.version}>
                  <td className="tabular py-2 pr-3 font-semibold">v{row.version}</td>
                  <td className="py-2 pr-3">{formatDate(row.effective_from)}</td>
                  <td className="py-2 text-ink-700">{row.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="新しいversionを作成"
          description="現在のルールを編集して保存すると、新しいversionとして登録されます (既存の評価は変わりません)"
        />
        <CardBody>
          <RulesForm currentRules={activeRules} />
        </CardBody>
      </Card>
    </div>
  );
}

export const dynamic = 'force-dynamic';
