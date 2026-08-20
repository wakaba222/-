import type { PromotionCondition } from '@/domain/types';

/**
 * 昇格条件の一覧。
 * 「何が足りないか」が一目で分かることがこの画面の唯一の目的なので、
 * 達成済みより未達の行を目立たせる。
 */
export function ConditionList({ conditions }: { conditions: PromotionCondition[] }) {
  if (conditions.length === 0) {
    return <p className="text-sm text-ink-500">昇格条件はありません (最上位ランクです)。</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {conditions.map((condition) => (
        <li key={condition.code} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm text-ink-900">{condition.label}</p>
            <p className="mt-0.5 text-xs text-ink-500">必要: {condition.requiredLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={condition.met ? 'tabular text-sm font-semibold text-eagle-700' : 'tabular text-sm font-semibold text-danger-600'}>
              {condition.currentLabel}
            </span>
            <span aria-hidden className="text-base">
              {condition.met ? '✅' : '❌'}
            </span>
            <span className="sr-only">{condition.met ? '達成' : '未達'}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
