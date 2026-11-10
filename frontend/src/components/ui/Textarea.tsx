import React, { forwardRef } from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  isMonospace?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      helperText,
      error,
      isMonospace = false,
      rows = 3,
      className = '',
      id,
      disabled,
      ...rest
    },
    ref
  ) => {
    const areaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1 font-sans">
        {label && (
          <label htmlFor={areaId} className="block text-[11px] font-medium text-slate-300">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          rows={rows}
          disabled={disabled}
          className={`w-full px-3 py-2 rounded-lg bg-[#080d17] border text-xs text-slate-200 placeholder-slate-600 transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
            error
              ? 'border-rose-500/50 focus:border-rose-500 ring-rose-500/20 focus:ring-1'
              : 'border-white/[0.08] focus:border-sky-500 ring-sky-500/20 focus:ring-1'
          } ${isMonospace ? 'font-mono' : 'font-sans'} ${className}`}
          {...rest}
        />
        {error ? (
          <p className="text-[10px] text-rose-400 mt-0.5">{error}</p>
        ) : helperText ? (
          <p className="text-[10px] text-slate-400 mt-0.5">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
