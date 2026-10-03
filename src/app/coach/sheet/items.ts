/**
 * Re:swing 診断シートのチェック項目。
 * 紙のシートと番号・並び順を一致させる (コーチが紙と見比べても迷わないように)。
 */
export interface SheetItem {
  no: number;
  label: string;
}

export interface SheetSection {
  index: number;
  title: string;
  english: string;
  tagline: string;
  items: SheetItem[];
}

export const MAX_SCORE = 100;

export const SHEET_SECTIONS: SheetSection[] = [
  {
    index: 1,
    title: '構え方編',
    english: 'SETUP',
    tagline: 'すべてのショットは、正しい構えから始まる。',
    items: [
      { no: 1, label: 'グリップ' },
      { no: 2, label: '前傾の作り方' },
      { no: 3, label: '肩甲骨をハメる' },
      { no: 4, label: 'フェースの向き' },
      { no: 5, label: '両足のデザイン' },
      { no: 6, label: '腰の位置' },
      { no: 7, label: '膝の向き' },
    ],
  },
  {
    index: 2,
    title: 'スイングドリル編',
    english: 'SWING DRILL',
    tagline: '正しい動きを繰り返すことが、確かな変化を生む。',
    items: [
      { no: 8, label: '振り子キャッチ' },
      { no: 9, label: '一回転ドリル' },
      { no: 10, label: 'つまむ連続素振り' },
      { no: 11, label: '一回転叩きドリル' },
      { no: 12, label: 'てこの原理ドリル' },
      { no: 13, label: '大の字練習' },
      { no: 14, label: '右手を叩くドリル' },
      { no: 15, label: '左手一本練習' },
      { no: 16, label: '歌舞伎ドリル' },
      { no: 17, label: '連続素振り' },
    ],
  },
];

export const ALL_ITEMS: SheetItem[] = SHEET_SECTIONS.flatMap((section) => section.items);

/** 入力欄の文字列を 0〜100 の整数に揃える。空欄・数字以外は空欄のまま残す */
export function normalizeScore(raw: string): string {
  const digits = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, '');
  if (digits === '') return '';
  return String(Math.min(MAX_SCORE, Number(digits)));
}
