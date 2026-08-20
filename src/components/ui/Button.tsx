'use client';

import { useFormStatus } from 'react-dom';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-eagle-900 text-white hover:bg-eagle-800 disabled:bg-ink-300',
  secondary: 'bg-white text-eagle-900 border border-eagle-900/20 hover:bg-eagle-50',
  ghost: 'bg-transparent text-ink-700 hover:bg-canvas',
  danger: 'bg-white text-danger-600 border border-danger-600/30 hover:bg-danger-100',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-eagle-600',
        'disabled:cursor-not-allowed disabled:opacity-70',
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Server Action 送信中は自動で無効化する。二重送信は売上の重複登録に直結するため */
export function SubmitButton({
  children,
  variant = 'primary',
  className,
  pendingLabel = '送信中…',
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className={className} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
