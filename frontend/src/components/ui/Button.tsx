import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-clay-600 hover:bg-clay-500 active:bg-clay-700 text-white shadow-sm',
  secondary: 'bg-[#14223b] hover:bg-[#1a2d4e] text-slate-200 hover:text-white border border-white/[0.06] active:bg-[#0f1a2e]',
  outline: 'bg-transparent hover:bg-white/[0.05] text-slate-300 hover:text-white border border-white/[0.08] active:bg-white/[0.08]',
  ghost: 'bg-transparent hover:bg-[#14223b] text-slate-400 hover:text-white active:bg-white/[0.1]',
  danger: 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 active:bg-rose-500/35',
  success: 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 active:bg-emerald-500/35',
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'text-[11px] px-2.5 py-1 gap-1 rounded-lg',
  sm: 'text-xs px-3 py-1.5 gap-1.5 rounded-xl',
  md: 'text-xs sm:text-sm px-4 py-2 gap-2 rounded-xl',
  lg: 'text-sm px-5 py-2.5 gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'sm',
      isLoading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      className = '',
      disabled,
      type = 'button',
      ...rest
    },
    ref
  ) => {
    const baseStyle =
      'inline-flex items-center justify-center font-medium font-sans transition select-none cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none';
    const computedClass = `${baseStyle} ${variantStyles[variant]} ${sizeStyles[size]} ${fullWidth ? 'w-full' : ''} ${className}`;

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        className={computedClass}
        {...rest}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-current" />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children && <span>{children}</span>}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
