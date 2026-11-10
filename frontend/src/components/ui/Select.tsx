import React, { forwardRef } from 'react';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options?: SelectOption[];
  isMonospace?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      helperText,
      error,
      options,
      children,
      isMonospace = false,
      className = '',
      id,
      disabled,
      ...rest
    },
    ref
  ) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1 font-sans">
        {label && (
          <label htmlFor={selectId} className="block text-[11px] font-medium text-slate-300">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          className={`w-full px-3 py-1.5 rounded-lg bg-[#0b1322] border text-xs text-white transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
            error
              ? 'border-rose-500/50 focus:border-rose-500'
              : 'border-white/[0.08] focus:border-sky-500'
          } ${isMonospace ? 'font-mono' : 'font-sans'} ${className}`}
          {...rest}
        >
          {options
            ? options.map((opt) => (
                <option key={String(opt.value)} value={opt.value} disabled={opt.disabled} className="bg-[#0b1322] text-white">
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        {error ? (
          <p className="text-[10px] text-rose-400 mt-0.5">{error}</p>
        ) : helperText ? (
          <p className="text-[10px] text-slate-400 mt-0.5">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Select.displayName = 'Select';
