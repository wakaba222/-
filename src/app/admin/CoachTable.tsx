'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { formatManYen, formatRate, formatScore } from '@/lib/format';
import type { AdminCoachRow } from '@/server/services/adminOverviewService';

type SortKey = 'name' | 'level' | 'professionalScore' | 'customerSuccessScore' | 'longTermRate' | 'monthlySales' | 'annualSales';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'コーチ名', numeric: false },
  { key: 'level', label: 'ランク', numeric: false },
  { key: 'professionalScore', label: 'Score', numeric: true },
  { key: 'customerSuccessScore', label: '顧客成果点', numeric: true },
  { key: 'longTermRate', label: '完全成果率', numeric: true },
  { key: 'monthlySales', label: '今月売上', numeric: true },
  { key: 'annualSales', label: '年間売上', numeric: true },
];

export function CoachTable({ rows }: { rows: AdminCoachRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('professionalScore');
  const [ascending, setAscending] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const filtered = rows
      .filter((row) => levelFilter === 'ALL' || row.level === levelFilter)
      .filter((row) => query.trim() === '' || row.name.includes(query.trim()));

    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv, 'ja');
      const an = av === null ? -1 : Number(av);
      const bn = bv === null ? -1 : Number(bv);
      return an - bn;
    });
    return ascending ? sorted : sorted.reverse();
  }, [rows, sortKey, ascending, levelFilter, query]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((prev) => !prev);
      return;
    }
    setSortKey(key);
    setAscending(false);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="コーチ名で絞り込み"
          className="min-h-9 rounded-lg border border-line px-3 text-sm focus:border-eagle-600 focus:outline-none"
        />
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="min-h-9 rounded-lg border border-line bg-white px-2 text-sm focus:border-eagle-600 focus:outline-none"
        >
          <option value="ALL">全ランク</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
          <option value="P4">P4</option>
        </select>
        <span className="text-xs text-ink-500">{visible.length}名を表示</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-500">
              {COLUMNS.map((column) => (
                <th key={column.key} className={column.numeric ? 'py-2 pr-3 text-right font-medium' : 'py-2 pr-3 font-medium'}>
                  <button type="button" onClick={() => toggleSort(column.key)} className="hover:text-ink-900">
                    {column.label}
                    {sortKey === column.key ? (ascending ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
              <th className="py-2 pr-3 text-right font-medium">短期成果率</th>
              <th className="py-2 pr-3 text-right font-medium">3ヶ月売上</th>
              <th className="py-2 pr-3 text-right font-medium">担当顧客</th>
              <th className="py-2 pr-3 font-medium">昇格</th>
              <th className="py-2 font-medium">行動</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row) => (
              <tr key={row.coachId} className="hover:bg-canvas">
                <td className="py-2.5 pr-3">
                  <Link href={`/admin/coaches/${row.coachId}`} className="font-medium text-ink-900 hover:text-eagle-700">
                    {row.name}
                  </Link>
                </td>
                <td className="py-2.5 pr-3 text-ink-700">{row.level}</td>
                <td className="tabular py-2.5 pr-3 text-right font-semibold">
                  {formatScore(row.professionalScore)}
                  <span className="ml-1 text-xs font-normal text-ink-500">{row.scoreBand}</span>
                </td>
                <td className="tabular py-2.5 pr-3 text-right">{formatScore(row.customerSuccessScore)}</td>
                <td className="tabular py-2.5 pr-3 text-right">
                  {formatRate(row.longTermRate)}
                  <span className="ml-1 text-xs text-ink-500">
                    ({row.achievedCount}/{row.eligibleCount})
                  </span>
                </td>
                <td className="tabular py-2.5 pr-3 text-right">{formatManYen(row.monthlySales)}</td>
                <td className="tabular py-2.5 pr-3 text-right">{formatManYen(row.annualSales)}</td>
                <td className="tabular py-2.5 pr-3 text-right">{formatRate(row.shortTermRate)}</td>
                <td className="tabular py-2.5 pr-3 text-right">{formatManYen(row.quarterlySales)}</td>
                <td className="tabular py-2.5 pr-3 text-right">{row.customerCount}名</td>
                <td className="py-2.5 pr-3">
                  {row.promotionStatus === 'CANDIDATE' || row.promotionStatus === 'CANDIDATE_REQUIRES_APPROVAL' ? (
                    <Badge tone="gold">候補</Badge>
                  ) : row.promotionStatus === 'MAX_LEVEL' ? (
                    <span className="text-xs text-ink-500">—</span>
                  ) : (
                    <span className="text-xs text-ink-500">残{row.promotionShortfalls}条件</span>
                  )}
                </td>
                <td className="py-2.5">
                  {row.behaviorStatus === 'OK' ? (
                    <Badge tone="success">OK</Badge>
                  ) : row.behaviorStatus === 'WARNING' ? (
                    <Badge tone="warn">WARNING</Badge>
                  ) : (
                    <Badge tone="danger">NG</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
