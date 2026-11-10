import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  children: React.ReactNode;
  hideCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
}

const sizeWidthStyles: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
  xl: 'max-w-2xl',
  '2xl': 'max-w-3xl',
  '3xl': 'max-w-4xl',
  '4xl': 'max-w-5xl',
  '5xl': 'max-w-6xl',
  full: 'max-w-[96vw]',
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  description,
  icon,
  badge,
  headerRight,
  footer,
  size = '3xl',
  children,
  hideCloseButton = false,
  className = '',
  bodyClassName = 'p-6 space-y-4',
}) => {
  const displaySubtitle = subtitle || description;
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${sizeWidthStyles[size]} max-h-[90vh] flex flex-col rounded-2xl bg-[#0c1424] border border-white/[0.08] shadow-2xl overflow-hidden font-sans z-10 animate-in zoom-in-95 duration-150 ${className}`}
      >
        {/* Modal Header */}
        {(title || icon || !hideCloseButton) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#0f1a2e] shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] text-sky-400 shrink-0">
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {typeof title === 'string' ? (
                    <h3 className="text-base font-semibold text-white tracking-tight truncate">
                      {title}
                    </h3>
                  ) : (
                    title
                  )}
                  {badge}
                </div>
                {displaySubtitle && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">{displaySubtitle}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-3">
              {headerRight}
              {!hideCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Tutup jendela"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

        {/* Modal Footer */}
        {footer && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.06] bg-[#0f1a2e] text-xs text-slate-400 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
