import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isMonospace?: boolean;
  monospace?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      isMonospace = false,
      monospace = false,
      className = '',
      id,
      disabled,
      ...rest
    },
    ref
  ) => {
    const useMono = isMonospace || monospace;
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1 font-sans">
        {label && (
          <label htmlFor={inputId} className="block text-[11px] font-medium text-slate-300">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-2.5 text-slate-400 pointer-events-none shrink-0">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            className={`w-full px-3 py-1.5 rounded-lg bg-[#0b1322] border text-xs text-white placeholder-slate-500 transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
              leftIcon ? 'pl-8' : ''
            } ${rightIcon ? 'pr-8' : ''} ${
              error
                ? 'border-rose-500/50 focus:border-rose-500 ring-rose-500/20 focus:ring-1'
                : 'border-white/[0.08] focus:border-sky-500 ring-sky-500/20 focus:ring-1'
            } ${useMono ? 'font-mono' : 'font-sans'} ${className}`}
            {...rest}
          />
          {rightIcon && (
            <div className="absolute right-2.5 text-slate-400 pointer-events-none shrink-0">
              {rightIcon}
            </div>
          )}
        </div>
        {error ? (
          <p className="text-[10px] text-rose-400 mt-0.5">{error}</p>
        ) : helperText ? (
          <p className="text-[10px] text-slate-400 mt-0.5">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
