import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsToYearMonth,
  effectiveElapsedMonths,
  elapsedMonths,
  endOfMonth,
  isDateOnly,
  recentYearMonths,
  todayInJst,
  yearMonthOf,
} from './date';

describe('elapsedMonths', () => {
  it('応当日に達して初めて1ヶ月経過とする', () => {
    expect(elapsedMonths('2026-01-15', '2026-02-14')).toBe(0);
    expect(elapsedMonths('2026-01-15', '2026-02-15')).toBe(1);
  });

  it('月末開始で応当日が存在しない月は末日で1ヶ月とみなす', () => {
    expect(elapsedMonths('2026-01-31', '2026-02-28')).toBe(1);
    expect(elapsedMonths('2026-01-31', '2026-03-30')).toBe(1);
    expect(elapsedMonths('2026-01-31', '2026-03-31')).toBe(2);
  });

  it('うるう年の2月末を正しく扱う', () => {
    expect(endOfMonth('2028-02')).toBe('2028-02-29');
    expect(elapsedMonths('2028-01-31', '2028-02-29')).toBe(1);
  });

  it('年跨ぎでも正しく数える', () => {
    expect(elapsedMonths('2025-11-01', '2026-03-01')).toBe(4);
  });

  it('開始日より前は0', () => {
    expect(elapsedMonths('2026-05-01', '2026-01-01')).toBe(0);
  });
});

describe('effectiveElapsedMonths', () => {
  it('休会日数分だけ経過を巻き戻す', () => {
    expect(effectiveElapsedMonths('2026-01-01', '2026-05-01', 0)).toBe(4);
    expect(effectiveElapsedMonths('2026-01-01', '2026-05-01', 40)).toBe(2);
  });
});

describe('年月ユーティリティ', () => {
  it('年跨ぎの加減算', () => {
    expect(addMonthsToYearMonth('2026-01', -1)).toBe('2025-12');
    expect(addMonthsToYearMonth('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToYearMonth('2026-03', -3)).toBe('2025-12');
  });

  it('直近3ヶ月は当月を含む', () => {
    expect(recentYearMonths('2026-05', 3)).toEqual(['2026-05', '2026-04', '2026-03']);
  });

  it('月末日', () => {
    expect(endOfMonth('2026-02')).toBe('2026-02-28');
    expect(endOfMonth('2026-04')).toBe('2026-04-30');
    expect(endOfMonth('2026-12')).toBe('2026-12-31');
  });

  it('yearMonthOf / addDays', () => {
    expect(yearMonthOf('2026-05-31')).toBe('2026-05');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('日付の妥当性・JST', () => {
  it('存在しない日付を弾く', () => {
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-02-28')).toBe(true);
  });

  it('UTCの日付が変わる前でもJSTでは翌日として扱う', () => {
    // 2026-05-31T16:00:00Z = 2026-06-01 01:00 JST
    expect(todayInJst(new Date('2026-05-31T16:00:00Z'))).toBe('2026-06-01');
    expect(todayInJst(new Date('2026-05-31T14:59:00Z'))).toBe('2026-05-31');
  });
});
