/** 表示整形。N/A (null) を「0」と誤表示しないための共通関数群 */

export const NOT_AVAILABLE = 'N/A';

export function formatScore(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return value.toFixed(fractionDigits);
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return NOT_AVAILABLE;
  return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`;
}

export function formatYen(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return `¥${value.toLocaleString('ja-JP')}`;
}

/** 金額を「万円」で丸めて表示 (一覧の可読性優先) */
export function formatManYen(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return `${Math.round(value / 10000).toLocaleString('ja-JP')}万`;
}

export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year}年${Number(month)}月`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  const [year, month, day] = date.slice(0, 10).split('-');
  return `${year}/${month}/${day}`;
}
