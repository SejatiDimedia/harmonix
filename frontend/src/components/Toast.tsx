import React from 'react';

interface ToastProps {
  message: string | null;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#0f1a2e] border border-white/[0.08] text-xs text-[#f8fafc] shadow-2xl font-mono no-print print:hidden backdrop-blur-md">
      <span>{message}</span>
    </div>
  );
};
