# 04. 評価ロジック設計 (擬似コード)

全ロジックは `src/domain/evaluation/` の **純粋関数**。DB・時刻・環境に一切依存しない。

## 0. 評価ルールJSON (v1初期値)

```jsonc
{
  "version": 1,
  "effective_from": "2026-01-01",

  "eligibility": {
    "min_elapsed_months": 4,          // 開始4ヶ月後から評価対象 (仕様7章)
    "require_goal_approved": true,    // ADMIN未承認の目標は評価に使わない (仕様6章)
    "count_suspended_months": false,  // 休会中は経過月数を進めない
    "include_cancelled": false,       // 途中解約は分母から除外
    "include_cancelled_reason_codes": ["PERFORMANCE"] // 成果不振解約だけは分母に残す
  },

  "customer_success": {
    "both_goal_rule": "ALL",          // BOTH=両方達成 (ANYに変更可)
    "long_term":  { "anchors": [[0, 0], [0.90, 30], [1.00, 36]], "max": 36 },
    "short_term": { "window_months": 3,
                    "anchors": [[0, 0], [0.90, 20], [1.00, 24]], "max": 24 }
  },

  "sales": {
    "include_coach_sns": false,       // MVP既定: SNS経由Re:Swingは売上点から除外 (仕様14章)
    "score_basis": "MONTHLY",         // MONTHLY | ROLLING_3M (Q2)
    "monthly":   { "anchors": [[0,0], [2000000, 40], [3500000, 50], [5000000, 60]] },
    "quarterly": { "anchors": [[0,0], [6000000, 40], [10500000, 50], [15000000, 60]] },
    "annual":    { "anchors": [[0,0], [24000000, 40], [42000000, 50], [60000000, 60]] },
    "max": 60
  },

  "score_bands": [
    { "min": 0,   "max": 79,  "label": "基準未達" },
    { "min": 80,  "max": 89,  "label": "基準クリア" },
    { "min": 90,  "max": 99,  "label": "高成果" },
    { "min": 100, "max": 109, "label": "非常に高成果" },
    { "min": 110, "max": 119, "label": "トップ水準" },
    { "min": 120, "max": 120, "label": "最高評価" }
  ],

  "quarterly_bonus": [                // 3ヶ月平均PSで決定 (単月判定しない)
    { "min": 0,   "amount": 0 },      { "min": 80,  "amount": 30000 },
    { "min": 90,  "amount": 50000 },  { "min": 100, "amount": 100000 },
    { "min": 110, "amount": 150000 }, { "min": 120, "amount": 200000 }
  ],

  "promotion": {
    "P1_TO_P2": {
      "consecutive_months": 3, "consecutive_min_score": 80,
      "average_months": 3,     "average_min_score": 90,
      "behavior_status_allowed": ["OK"],
      "min_long_term_rate": null, "required_checks": []
    },
    "P2_TO_P3": {
      "consecutive_months": 3, "consecutive_min_score": 90,
      "average_months": 3,     "average_min_score": 100,
      "behavior_status_allowed": ["OK"],
      "min_long_term_rate": 0.90,
      "required_checks": [{ "code": "SENIOR_ACTIVITY", "required_count": 2 }]
    },
    "P3_TO_P4": {
      "consecutive_months": 3, "consecutive_min_score": 100,
      "average_months": 3,     "average_min_score": 105,
      "behavior_status_allowed": ["OK"],
      "min_long_term_rate": 0.90,
      "required_checks": [{ "code": "OWN_BUSINESS_RESULT", "required_count": 1 }],
      "requires_admin_approval": true   // P4は必ずADMIN最終承認 (仕様19章)
    }
  },

  "lesson_unit_price": { "P1": 0, "P2": 10000, "P3": 12000, "P4": 15000 }
}
```

> 数値は全てここにある。**コード中に閾値リテラルを書かない (magic number禁止)**。

---

## 1. 全配点の共通基盤: 折れ線アンカー補間

```ts
/**
 * アンカー点列を区間線形補間する。全ての配点(長期/短期/売上)がこの1関数を通る。
 * 「90%=30点, 100%=36点」のような複数基準を、傾きを固定せず表現するための実装。
 */
function interpolateScore(value: number, anchors: [number, number][], max: number): number {
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  if (value <= sorted[0][0]) return clamp(sorted[0][1], 0, max);
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x1, y1] = sorted[i], [x2, y2] = sorted[i + 1];
    if (value <= x2) {
      const ratio = (value - x1) / (x2 - x1);       // x2 > x1 はルール検証で保証
      return clamp(y1 + (y2 - y1) * ratio, 0, max);
    }
  }
  // 最終アンカー超過分は最後の区間の傾きで外挿し、maxでクランプ (上限120%評価)
  const [xa, ya] = sorted.at(-2)!, [xb, yb] = sorted.at(-1)!;
  return clamp(yb + ((value - xb) * (yb - ya)) / (xb - xa), 0, max);
}
```

## 2. 評価対象判定 (仕様7章)

```ts
function isLongTermEligible(customer, asOfMonthEnd, rules): boolean {
  if (customer.goalApprovalStatus !== 'APPROVED') return false;      // 未承認は対象外
  if (customer.status === 'SUSPENDED') return false;
  if (customer.status === 'CANCELLED'
      && !rules.eligibility.include_cancelled_reason_codes
              .includes(customer.cancelReasonCode)) return false;

  const elapsed = elapsedMonths(customer.programStartDate, asOfMonthEnd,
                                { excludeSuspendedPeriods: !rules.eligibility.count_suspended_months });
  return elapsed >= rules.eligibility.min_elapsed_months;            // 既定=4
}
// 3ヶ月目 → false (Case 1) / 4ヶ月目 → true (Case 2)
// プログラム終了(COMPLETED)後も true のまま → 終了後の達成が加算される (Case 3)
```

## 3. 完全達成判定 (仕様8章)

```ts
function judgeCompleteSuccess(record, goalAtThatDate, rules): boolean {
  const okScore    = goal.targetScore    != null && record.score    != null
                     && record.score    <= goal.targetScore;   // スコアは小さいほど良い
  const okDistance = goal.targetDistance != null && record.distance != null
                     && record.distance >= goal.targetDistance;// 飛距離は大きいほど良い
  switch (goal.goalType) {
    case 'SCORE':    return okScore;
    case 'DISTANCE': return okDistance;
    case 'BOTH':     return rules.customer_success.both_goal_rule === 'ALL'
                            ? (okScore && okDistance) : (okScore || okDistance);
  }
}
// ラチェット: 一度trueなら achieved_at を確定し、以降の悪化では取り消さない (Q7)
```

## 4. 長期 (完全成果率) — 仕様10-A

```ts
function calcLongTerm(customers, asOfMonthEnd, rules) {
  const targets = customers.filter(c => isLongTermEligible(c, asOfMonthEnd, rules));
  if (targets.length === 0) {
    return { rate: null, score: null, evaluable: false };            // N/A。0点にしない (仕様36章)
  }
  const achieved = targets.filter(c => c.completeSuccessAt != null
                                    && c.completeSuccessAt <= asOfMonthEnd);
  const rate = achieved.length / targets.length;
  return { rate, targetCount: targets.length, achievedCount: achieved.length,
           score: interpolateScore(rate, rules.customer_success.long_term.anchors, 36),
           evaluable: true };
}
// rate 0.90 → 30.0 (Case 4) / rate 1.00 → 36.0 (Case 5)
```

## 5. 短期 (直近3ヶ月成果率) — 仕様10-B / Q4案C

```ts
function calcShortTerm(customers, asOfMonthEnd, rules) {
  const windowStart = startOfMonth(addMonths(asOfMonthEnd, -(rules.window_months - 1)));

  // 分母: 「この3ヶ月で成果を出すべきだった顧客」
  //   = 期間開始時点で評価対象かつ未達成 ＋ 期間中に新たに評価対象になった顧客
  const targets = customers.filter(c => {
    const eligibleInWindow = isLongTermEligible(c, asOfMonthEnd, rules);
    if (!eligibleInWindow) return false;
    const achievedBeforeWindow = c.completeSuccessAt != null && c.completeSuccessAt < windowStart;
    return !achievedBeforeWindow;      // 期間前に達成済みの顧客は分母から外す
  });
  if (targets.length === 0) return { rate: null, score: null, evaluable: false };

  // 分子: 期間内に完全達成した顧客
  const achieved = targets.filter(c => c.completeSuccessAt != null
                                    && c.completeSuccessAt >= windowStart
                                    && c.completeSuccessAt <= asOfMonthEnd);
  const rate = achieved.length / targets.length;
  return { rate, targetCount: targets.length, achievedCount: achieved.length,
           score: interpolateScore(rate, rules.customer_success.short_term.anchors, 24),
           evaluable: true };
}
// rate 0.90 → 20.0 (Case 6) / rate 1.00 → 24.0 (Case 7)
```

## 6. 顧客成果点 — 仕様11章

```ts
function calcCustomerSuccess(long, short) {
  if (!long.evaluable && !short.evaluable) return { score: null, evaluable: false };
  // 片方だけN/Aの場合は、評価可能な側のみを合算し「部分評価」フラグを立てる
  return { score: (long.score ?? 0) + (short.score ?? 0),
           evaluable: true, partial: !long.evaluable || !short.evaluable };
}
// 30 + 20 = 50 (通常) / 36 + 24 = 60 (最大)
```

## 7. 売上点 — 仕様12,14,15章

```ts
function calcSales(sales, period, rules) {
  const net = sales
    .filter(s => s.status === 'ACTIVE' && !s.deletedAt)
    .filter(s => s.product.isSalesScoreTarget)                       // 商品マスタで対象/対象外
    .filter(s => rules.sales.include_coach_sns || s.acquisitionSource !== 'COACH_SNS')
    .filter(s => within(s.soldOn, period))
    .reduce((sum, s) => sum + (s.amount - (s.refundAmount ?? 0)), 0);

  const anchors = rules.sales.score_basis === 'ROLLING_3M'
                ? rules.sales.quarterly.anchors : rules.sales.monthly.anchors;
  return { amount: net, score: interpolateScore(net, anchors, rules.sales.max) };
}
// 月次 350万 → 50.0点 / 500万 → 60.0点 / 200万 → 40.0点
```

## 8. Professional Score — 仕様16,17章

```ts
function calcProfessionalScore(customerSuccess, sales, rules) {
  if (!customerSuccess.evaluable) {
    return { score: null, band: 'N/A', evaluable: false,
             reason: '評価対象顧客が0名のため算出不能' };
  }
  const score = round1(customerSuccess.score + sales.score);         // 上限120
  return { score, band: bandOf(score, rules.score_bands), evaluable: true };
}
// 50 + 50 = 100 (Case 8) / 60 + 60 = 120 (Case 9)
```

## 9. 四半期ボーナス — 仕様18章

```ts
function calcQuarterlyBonus(snapshots3m, rules) {
  const valid = snapshots3m.filter(s => s.isEvaluable);
  if (valid.length < 2) return { amount: 0, avg: null, status: 'EVALUATION_INSUFFICIENT' }; // Q5
  const avg = mean(valid.map(s => s.professionalScore));
  const tier = [...rules.quarterly_bonus].reverse().find(t => avg >= t.min);
  return { amount: tier.amount, avg, monthsUsed: valid.length };
}
// 3ヶ月平均 105 → 100,000円 (Case 10)
```

## 10. 昇格判定 — 仕様19章 (AND条件 / 条件ごとの結果を返すのが肝)

```ts
function evaluatePromotion(coach, snapshots, behaviorStatus, checks, rules) {
  const rule = rules.promotion[`${coach.rank}_TO_${nextRank(coach.rank)}`];
  if (!rule) return { eligible: false, reason: '最上位ランク' };

  const recent = latestNSnapshots(snapshots, rule.consecutive_months);
  const conditions = [
    { code: 'CONSECUTIVE',
      label: `${rule.consecutive_months}ヶ月連続 Score ${rule.consecutive_min_score}以上`,
      current: recent.filter(s => s.professionalScore >= rule.consecutive_min_score).length,
      required: rule.consecutive_months,
      met: recent.length === rule.consecutive_months
        && recent.every(s => s.professionalScore >= rule.consecutive_min_score) },

    { code: 'AVERAGE', label: `${rule.average_months}ヶ月平均 ${rule.average_min_score}以上`,
      current: mean(recent.map(s => s.professionalScore)),
      required: rule.average_min_score,
      met: mean(recent.map(s => s.professionalScore)) >= rule.average_min_score },

    ...(rule.min_long_term_rate != null ? [{
      code: 'LONG_TERM_RATE', label: `完全成果率 ${pct(rule.min_long_term_rate)}以上`,
      current: latest(snapshots).longTermSuccessRate,
      required: rule.min_long_term_rate,
      met: (latest(snapshots).longTermSuccessRate ?? 0) >= rule.min_long_term_rate }] : []),

    { code: 'BEHAVIOR', label: 'EAGLE行動ルール',
      current: behaviorStatus, required: 'OK',
      met: rule.behavior_status_allowed.includes(behaviorStatus) },   // NGなら昇格不可 (仕様20章)

    ...rule.required_checks.map(rc => ({
      code: rc.code, label: requirementLabel(rc.code),
      current: checks[rc.code]?.achievedCount ?? 0, required: rc.required_count,
      met: (checks[rc.code]?.achievedCount ?? 0) >= rc.required_count })),
  ];

  const allMet = conditions.every(c => c.met);
  return {
    conditions,                                    // ← 画面で「何が足りないか」をそのまま表示
    status: !allMet ? 'NOT_ELIGIBLE'
          : rule.requires_admin_approval ? 'CANDIDATE_REQUIRES_APPROVAL' : 'CANDIDATE',
    shortfalls: conditions.filter(c => !c.met),
  };
}
// 1条件でも未達 → NOT_ELIGIBLE (Case 12) / 全達成 → CANDIDATE (Case 13)
```

## 11. 「あと何名で90%か」の逆算 (仕様21章)

コーチダッシュボードで最も行動に効く表示。

```ts
/** 現在の分母のまま、目標達成率に到達するのに追加で必要な達成人数 */
function customersNeededFor(targetRate: number, achieved: number, total: number): number {
  if (total === 0) return 0;
  return Math.max(0, Math.ceil(targetRate * total - achieved));      // 0除算しない
}
// 例) 34/39 = 87.2% → 90%まで ceil(0.9*39) - 34 = 36 - 34 = 「あと2名」
```

## 12. 給与シミュレーション (参考値・仕様39章)

```ts
monthlyEstimate =
    (lessonCount ?? 0) * rules.lesson_unit_price[coach.rank]     // レッスン数未入力なら非表示
  + sum(activeSales.map(s => s.incentiveAmount))                 // 成約ショットインセン
  + (isQuarterEndMonth ? quarterlyBonus.amount : 0);             // 四半期ボーナス
// 画面には必ず「参考値 / 実際の給与計算とは分離」と明示する
```
