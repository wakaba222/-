'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, TextInput } from '@/components/ui/Field';
import { ALL_ITEMS, MAX_SCORE, SHEET_SECTIONS, normalizeScore, type SheetSection } from './items';

interface SheetState {
  studentName: string;
  coachName: string;
  date: string;
  scores: Record<number, string>;
  memos: Record<number, string>;
}

/**
 * 書きかけのシートは端末内にだけ残す。
 * 誤ってページを閉じても入力が消えないようにするためで、サーバーには送らない。
 */
const DRAFT_KEY = 'reswing-sheet-draft-v1';

function emptySheet(coachName: string, today: string): SheetState {
  return { studentName: '', coachName, date: today, scores: {}, memos: {} };
}

function readDraft(): SheetState | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SheetState>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      studentName: String(parsed.studentName ?? ''),
      coachName: String(parsed.coachName ?? ''),
      date: String(parsed.date ?? ''),
      scores: parsed.scores ?? {},
      memos: parsed.memos ?? {},
    };
  } catch {
    return null;
  }
}

function writeDraft(state: SheetState | null): void {
  try {
    if (state === null) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    // プライベートブラウズ等で保存できなくても、入力と印刷はそのまま使える
  }
}

/** 印刷時の日付表記。紙のシートの「　/　/　」欄に合わせる */
function formatPrintDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return '';
  return `${match[1]} / ${Number(match[2])} / ${Number(match[3])}`;
}

export function DiagnosisSheet({
  coachName,
  today,
  customerNames,
}: {
  coachName: string;
  today: string;
  customerNames: string[];
}) {
  const [sheet, setSheet] = useState<SheetState>(() => emptySheet(coachName, today));
  const [draftLoaded, setDraftLoaded] = useState(false);
  const datalistId = useId();

  // localStorage はサーバー描画時に読めないため、表示後に書きかけを復元する
  useEffect(() => {
    const draft = readDraft();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 端末内の下書きはマウント後にしか読めない
    if (draft) setSheet(draft);
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (draftLoaded) writeDraft(sheet);
  }, [sheet, draftLoaded]);

  const filledCount = ALL_ITEMS.filter((item) => (sheet.scores[item.no] ?? '') !== '').length;

  function setScore(no: number, raw: string) {
    setSheet((prev) => ({ ...prev, scores: { ...prev.scores, [no]: normalizeScore(raw) } }));
  }

  function setMemo(no: number, value: string) {
    setSheet((prev) => ({ ...prev, memos: { ...prev.memos, [no]: value } }));
  }

  function resetSheet() {
    if (!window.confirm('入力内容を消して、新しいシートにしますか？')) return;
    const fresh = emptySheet(coachName, today);
    setSheet(fresh);
    writeDraft(null);
  }

  return (
    <>
      <div className="space-y-4 print:hidden">
        <Card>
          <CardHeader
            title="Re:swing 診断シート"
            description="空欄に入れるだけで、A4一枚の診断シートとして印刷・PDF保存できます"
          />
          <CardBody className="space-y-3">
            <Field label="お名前">
              <TextInput
                value={sheet.studentName}
                onChange={(e) => setSheet((prev) => ({ ...prev, studentName: e.target.value }))}
                list={datalistId}
                placeholder="例）山田 太郎"
                autoComplete="off"
              />
              <datalist id={datalistId}>
                {customerNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="コーチ">
                <TextInput
                  value={sheet.coachName}
                  onChange={(e) => setSheet((prev) => ({ ...prev, coachName: e.target.value }))}
                  autoComplete="off"
                />
              </Field>
              <Field label="日付">
                <TextInput
                  type="date"
                  value={sheet.date}
                  onChange={(e) => setSheet((prev) => ({ ...prev, date: e.target.value }))}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        {SHEET_SECTIONS.map((section) => (
          <SectionForm
            key={section.index}
            section={section}
            scores={sheet.scores}
            memos={sheet.memos}
            onScore={setScore}
            onMemo={setMemo}
          />
        ))}

        <div className="sticky bottom-16 z-10 flex items-center gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur">
          <span className="tabular mr-auto whitespace-nowrap text-xs text-ink-500">
            入力 {filledCount}/{ALL_ITEMS.length}
          </span>
          <Button type="button" variant="ghost" className="whitespace-nowrap px-3" onClick={resetSheet}>
            新規
          </Button>
          <Button type="button" className="whitespace-nowrap" onClick={() => window.print()}>
            印刷・PDF保存
          </Button>
        </div>
      </div>

      <PrintSheet sheet={sheet} />
    </>
  );
}

function SectionForm({
  section,
  scores,
  memos,
  onScore,
  onMemo,
}: {
  section: SheetSection;
  scores: Record<number, string>;
  memos: Record<number, string>;
  onScore: (no: number, raw: string) => void;
  onMemo: (no: number, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-baseline gap-2">
            <span className="text-gold-600">{section.index}</span>
            {section.title}
            <span className="text-[10px] font-normal tracking-[0.2em] text-ink-500">{section.english}</span>
          </span>
        }
      />
      <ul className="divide-y divide-line">
        {section.items.map((item) => (
          <li key={item.no} className="space-y-2 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="tabular w-6 shrink-0 text-center text-sm font-semibold text-gold-600">{item.no}</span>
              <span className="flex-1 text-sm font-medium text-ink-900">{item.label}</span>
              <label className="flex items-center gap-1">
                <span className="sr-only">{item.label}の評価</span>
                <input
                  value={scores[item.no] ?? ''}
                  onChange={(e) => onScore(item.no, e.target.value)}
                  inputMode="numeric"
                  enterKeyHint="next"
                  placeholder="—"
                  className="tabular w-16 rounded-lg border border-line bg-white px-2 py-2 text-right text-base font-semibold text-ink-900 focus:border-eagle-600 focus:outline-none focus:ring-2 focus:ring-eagle-600/20"
                />
                <span className="tabular text-xs text-ink-500">/ {MAX_SCORE}</span>
              </label>
            </div>
            <label className="block pl-9">
              <span className="sr-only">{item.label}のメモ</span>
              <input
                value={memos[item.no] ?? ''}
                onChange={(e) => onMemo(item.no, e.target.value)}
                placeholder="メモ"
                enterKeyHint="next"
                className="w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-ink-900 focus:border-eagle-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-eagle-600/20"
              />
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 印刷専用の A4 一枚。画面には出さず、印刷・PDF 保存のときだけ使う */
function PrintSheet({ sheet }: { sheet: SheetState }) {
  return (
    <div className="rs-sheet hidden print:block" aria-hidden>
      <div className="rs-decor rs-decor-tl" />
      <div className="rs-decor rs-decor-br" />
      <div className="rs-ball" />

      <header className="rs-title">
        <h1>
          <span className="rs-title-re">Re:</span>
          <span className="rs-title-swing">swing</span>
          <span className="rs-title-ja">診断シート</span>
        </h1>
        <div className="rs-title-rule" />
      </header>

      {SHEET_SECTIONS.map((section) => (
        <section key={section.index} className="rs-section">
          <div className="rs-section-head">
            <div className="rs-section-index">{section.index}</div>
            <div className="rs-section-title">{section.title}</div>
            <div className="rs-section-en">{section.english}</div>
            <div className="rs-section-line" />
            <div className="rs-section-tagline">{section.tagline}</div>
          </div>
          <table className="rs-table">
            <colgroup>
              <col className="rs-col-no" />
              <col className="rs-col-label" />
              <col className="rs-col-max" />
              <col className="rs-col-score" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>No.</th>
                <th>チェック項目</th>
                <th>配点</th>
                <th>評価（/{MAX_SCORE}）</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {section.items.map((item) => {
                const score = sheet.scores[item.no] ?? '';
                return (
                  <tr key={item.no}>
                    <td className="rs-no">{item.no}</td>
                    <td className="rs-label">{item.label}</td>
                    <td className="rs-max">
                      {MAX_SCORE}
                      <small>点</small>
                    </td>
                    <td className="rs-score">
                      {score !== '' ? <strong>{score}</strong> : null}
                      <span className="rs-score-max"> / {MAX_SCORE}</span>
                    </td>
                    <td className="rs-memo">
                      <div>{sheet.memos[item.no] ?? ''}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <footer className="rs-footer">
        <div className="rs-box">
          <span className="rs-box-label">お名前</span>
          <span className="rs-box-value">{sheet.studentName}</span>
        </div>
        <div className="rs-box">
          <span className="rs-box-label">コーチ</span>
          <span className="rs-box-value">{sheet.coachName}</span>
        </div>
        <div className="rs-box">
          <span className="rs-box-label">日付</span>
          <span className="rs-box-value">{formatPrintDate(sheet.date) || '\u3000\u3000/\u3000\u3000/'}</span>
        </div>
      </footer>
    </div>
  );
}
