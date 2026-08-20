-- ============================================================================
-- マスタ初期データ
--   * 評価ルール v1 (仕様10/15/17/18/19章の初期値)
--   * 商品マスタ (仕様13章)
-- どちらも運用開始に必須のため、デモ用 seed ではなくマイグレーションで投入する。
-- ============================================================================

insert into public.evaluation_rules (version, effective_from, rules, note) values (
  1,
  '2026-01-01',
  '{
    "version": 1,
    "effectiveFrom": "2026-01-01",
    "eligibility": {
      "minElapsedMonths": 4,
      "requireGoalApproved": true,
      "countSuspendedMonths": false,
      "includeCancelledReasonCodes": ["PERFORMANCE"]
    },
    "customerSuccess": {
      "bothGoalRule": "ALL",
      "longTerm": { "anchors": [[0, 0], [0.9, 30], [1, 36]], "max": 36 },
      "shortTerm": { "windowMonths": 3, "anchors": [[0, 0], [0.9, 20], [1, 24]], "max": 24 }
    },
    "sales": {
      "includeCoachSns": false,
      "scoreBasis": "MONTHLY",
      "monthly":   { "anchors": [[0, 0], [2000000, 40], [3500000, 50], [5000000, 60]] },
      "quarterly": { "anchors": [[0, 0], [6000000, 40], [10500000, 50], [15000000, 60]] },
      "annual":    { "anchors": [[0, 0], [24000000, 40], [42000000, 50], [60000000, 60]] },
      "max": 60
    },
    "scoreBands": [
      { "min": 0,   "max": 79.999,  "label": "基準未達" },
      { "min": 80,  "max": 89.999,  "label": "基準クリア" },
      { "min": 90,  "max": 99.999,  "label": "高成果" },
      { "min": 100, "max": 109.999, "label": "非常に高成果" },
      { "min": 110, "max": 119.999, "label": "トップ水準" },
      { "min": 120, "max": 120,     "label": "最高評価" }
    ],
    "quarterlyBonus": [
      { "min": 0,   "amount": 0 },
      { "min": 80,  "amount": 30000 },
      { "min": 90,  "amount": 50000 },
      { "min": 100, "amount": 100000 },
      { "min": 110, "amount": 150000 },
      { "min": 120, "amount": 200000 }
    ],
    "promotion": {
      "P1_TO_P2": {
        "consecutiveMonths": 3, "consecutiveMinScore": 80,
        "averageMonths": 3, "averageMinScore": 90,
        "behaviorStatusAllowed": ["OK"], "minLongTermRate": null,
        "requiredChecks": [], "requiresAdminApproval": false
      },
      "P2_TO_P3": {
        "consecutiveMonths": 3, "consecutiveMinScore": 90,
        "averageMonths": 3, "averageMinScore": 100,
        "behaviorStatusAllowed": ["OK"], "minLongTermRate": 0.9,
        "requiredChecks": [{ "code": "SENIOR_ACTIVITY", "label": "上位活動要件 (1対多数の専門性)", "requiredCount": 2 }],
        "requiresAdminApproval": false
      },
      "P3_TO_P4": {
        "consecutiveMonths": 3, "consecutiveMinScore": 100,
        "averageMonths": 3, "averageMinScore": 105,
        "behaviorStatusAllowed": ["OK"], "minLongTermRate": 0.9,
        "requiredChecks": [{ "code": "OWN_BUSINESS_RESULT", "label": "本人起点の事業成果", "requiredCount": 1 }],
        "requiresAdminApproval": true
      }
    },
    "lessonUnitPrice": { "P1": 0, "P2": 10000, "P3": 12000, "P4": 15000 }
  }'::jsonb,
  '初期ルール。仕様書の数値をそのまま反映'
);

insert into public.products (code, name, default_price, incentive_amount, is_sales_score_target, sort_order) values
  ('RESTART',          'RE:START',          498000,  10000, true, 10),
  ('BREAKTHROUGH',     'BREAKTHROUGH',      899000,  20000, true, 20),
  ('HIGH_PERFORMANCE', 'HIGH PERFORMANCE', 2000000,  50000, true, 30),
  ('EVENT_SMALL',      '小規模イベント',      100000,      0, true, 40),
  ('EVENT_MEDIUM',     '中規模イベント',      300000,      0, true, 50),
  ('EVENT_LARGE',      '大規模イベント',     1000000,      0, true, 60);
