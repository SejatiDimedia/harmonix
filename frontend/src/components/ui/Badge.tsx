import React from 'react';

export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'purple';
export type BadgeSize = 'xs' | 'sm';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  pulse?: boolean;
  icon?: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; dotColor: string }> = {
  success: {
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-300',
    dotColor: 'bg-emerald-400',
  },
  danger: {
    bg: 'bg-rose-500/20',
    text: 'text-rose-300',
    dotColor: 'bg-rose-400',
  },
  warning: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-300',
    dotColor: 'bg-amber-400',
  },
  info: {
    bg: 'bg-sky-500/15',
    text: 'text-sky-300',
    dotColor: 'bg-sky-400',
  },
  neutral: {
    bg: 'bg-[#14223b]',
    text: 'text-slate-300',
    dotColor: 'bg-slate-400',
  },
  purple: {
    bg: 'bg-purple-500/15',
    text: 'text-purple-300',
    dotColor: 'bg-purple-400',
  },
};

const sizeStyles: Record<BadgeSize, string> = {
  xs: 'text-[10px] px-2 py-0.5 gap-1',
  sm: 'text-xs px-2.5 py-0.5 gap-1.5',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'xs',
  dot = false,
  pulse = false,
  icon,
  className = '',
  ...rest
}) => {
  const config = variantStyles[variant];
  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded-full transition ${config.bg} ${config.text} ${sizeStyles[size]} ${className}`}
      {...rest}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.dotColor} shrink-0 ${pulse ? 'animate-pulse' : ''}`}
        />
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
