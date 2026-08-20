/**
 * 全ての配点 (長期成果・短期成果・売上) が通る共通の補間器。
 *
 * 「90% = 30点 / 100% = 36点」のように基準点が複数与えられる仕様のため、
 * 単一の傾きではなくアンカー点列の折れ線として表現する。
 * これにより将来「基準を3段階から5段階に増やす」もルールJSONの変更だけで済む。
 */

/** [入力値, 点数] のアンカー点 */
export type Anchor = readonly [number, number];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 表示・保存時の丸め (小数第1位)。浮動小数の誤差を評価結果に持ち込まない */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * アンカー点列を区間線形補間して点数を返す。
 * - 最小アンカー未満は最小アンカーの点数
 * - 最大アンカー超過は最終区間の傾きで外挿し、max でクランプ (120%評価の上限)
 */
export function interpolateScore(value: number, anchors: readonly Anchor[], max: number): number {
  if (anchors.length === 0) return 0;
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  const first = sorted[0]!;
  if (value <= first[0]) return clamp(first[1], 0, max);

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const [x1, y1] = sorted[i]!;
    const [x2, y2] = sorted[i + 1]!;
    if (value <= x2) {
      // x2 === x1 のアンカー重複はルール検証で弾いているが、念のため 0 除算を避ける
      if (x2 === x1) return clamp(y2, 0, max);
      const ratio = (value - x1) / (x2 - x1);
      return clamp(y1 + (y2 - y1) * ratio, 0, max);
    }
  }

  const last = sorted[sorted.length - 1]!;
  const prev = sorted[sorted.length - 2];
  if (!prev || last[0] === prev[0]) return clamp(last[1], 0, max);
  const slope = (last[1] - prev[1]) / (last[0] - prev[0]);
  return clamp(last[1] + (value - last[0]) * slope, 0, max);
}

/**
 * 目標達成率に到達するために追加で必要な達成人数。
 * コーチダッシュボードの「あと○名で90%」表示に使う。
 */
export function countNeededForRate(targetRate: number, achieved: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.ceil(targetRate * total - achieved));
}
