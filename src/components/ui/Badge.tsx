import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'gold';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-700 border-line',
  success: 'bg-eagle-50 text-eagle-800 border-eagle-100',
  warn: 'bg-warn-100 text-warn-600 border-warn-100',
  danger: 'bg-danger-100 text-danger-600 border-danger-100',
  gold: 'bg-gold-100 text-gold-600 border-gold-100',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CLASS[tone])}>
      {children}
    </span>
  );
}
