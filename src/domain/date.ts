/**
 * 日付ユーティリティ (純粋関数)
 *
 * 評価ロジックは全て JST の「日付」単位で判定する。
 * Date オブジェクトを使うとサーバーのタイムゾーンで月境界がズレるため、
 * ここでは 'YYYY-MM-DD' 文字列と整数演算のみで日付を扱う。
 */

/** 'YYYY-MM-DD' */
export type DateOnly = string;
/** 'YYYY-MM' */
export type YearMonth = string;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export function isDateOnly(value: string): value is DateOnly {
  return DATE_PATTERN.test(value) && civilFromDays(daysFromCivilString(value)) === value;
}

export function isYearMonth(value: string): value is YearMonth {
  return YEAR_MONTH_PATTERN.test(value);
}

function parts(date: DateOnly): { y: number; m: number; d: number } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return { y, m, d };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Howard Hinnant の civil_from_days / days_from_civil アルゴリズム。
 * Date を介さず日数差を求めるため、タイムゾーン・夏時間の影響を受けない。
 */
function daysFromCivil(y: number, m: number, d: number): number {
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function daysFromCivilString(date: DateOnly): number {
  const { y, m, d } = parts(date);
  return daysFromCivil(y, m, d);
}

function civilFromDays(z: number): DateOnly {
  const shifted = z + 719468;
  const era = Math.floor(shifted / 146097);
  const doe = shifted - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return `${String(m <= 2 ? y + 1 : y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

export function toEpochDay(date: DateOnly): number {
  return daysFromCivilString(date);
}

export function fromEpochDay(day: number): DateOnly {
  return civilFromDays(day);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  return fromEpochDay(toEpochDay(date) + days);
}

export function diffDays(from: DateOnly, to: DateOnly): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** 文字列比較で日付比較が成立する ('YYYY-MM-DD' は辞書順 = 時系列順) */
export function compareDate(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isOnOrBefore(a: DateOnly, b: DateOnly): boolean {
  return a <= b;
}

export function isOnOrAfter(a: DateOnly, b: DateOnly): boolean {
  return a >= b;
}

export function isWithin(date: DateOnly, from: DateOnly, to: DateOnly): boolean {
  return date >= from && date <= to;
}

export function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return lengths[month - 1] ?? 30;
}

export function yearMonthOf(date: DateOnly): YearMonth {
  return date.slice(0, 7);
}

export function startOfMonth(ym: YearMonth): DateOnly {
  return `${ym}-01`;
}

export function endOfMonth(ym: YearMonth): DateOnly {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return `${ym}-${pad2(daysInMonth(y, m))}`;
}

export function addMonthsToYearMonth(ym: YearMonth, months: number): YearMonth {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const total = y * 12 + (m - 1) + months;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad2((total % 12) + 1)}`;
}

/** 新しい順に n ヶ月分の年月キーを返す (先頭が ym) */
export function recentYearMonths(ym: YearMonth, count: number): YearMonth[] {
  return Array.from({ length: count }, (_, i) => addMonthsToYearMonth(ym, -i));
}

/**
 * 経過月数 (満月数)。
 * 応当日に達していない月はカウントしない。開始日が月末で応当日が存在しない場合
 * (例: 1/31 開始 → 2/28) は、その月の末日をもって1ヶ月経過とみなす。
 */
export function elapsedMonths(start: DateOnly, asOf: DateOnly): number {
  if (asOf < start) return 0;
  const s = parts(start);
  const a = parts(asOf);
  let months = (a.y - s.y) * 12 + (a.m - s.m);
  const anniversaryDay = Math.min(s.d, daysInMonth(a.y, a.m));
  if (a.d < anniversaryDay) months -= 1;
  return Math.max(0, months);
}

/**
 * 休会日数を差し引いた実質経過月数。
 * 休会中は評価対象までのカウントを進めない (仕様36章「休会」への対応)。
 */
export function effectiveElapsedMonths(start: DateOnly, asOf: DateOnly, suspendedDays: number): number {
  const effectiveAsOf = suspendedDays > 0 ? addDays(asOf, -suspendedDays) : asOf;
  return elapsedMonths(start, effectiveAsOf);
}

export function todayInJst(now: Date = new Date()): DateOnly {
  // JST は UTC+9 固定 (夏時間なし)
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}
