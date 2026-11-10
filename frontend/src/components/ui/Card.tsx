import React from 'react';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'surface' | 'dark' | 'glass';
  padding?: CardPadding;
  isInteractive?: boolean;
}

const variantStyles = {
  default: 'bg-[#0f1a2e] border-white/[0.06]',
  surface: 'bg-[#14223b] border-white/[0.08]',
  dark: 'bg-[#0b1322] border-white/[0.04]',
  glass: 'bg-[#0b1526]/80 backdrop-blur-md border-white/[0.08]',
};

const paddingStyles: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  padding = 'md',
  isInteractive = false,
  className = '',
  ...rest
}) => {
  return (
    <div
      className={`rounded-xl border ${variantStyles[variant]} ${paddingStyles[padding]} transition shadow-sm font-sans ${
        isInteractive ? 'hover:border-white/[0.14] cursor-pointer' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};
