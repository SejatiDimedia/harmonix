import React from 'react';

interface ToastProps {
  message: string | null;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#1f1e1b] border border-[#383632] text-xs text-[#f5f4ef] shadow-xl font-mono no-print print:hidden backdrop-blur-md">
      <span className="w-2 h-2 rounded-full bg-clay-500 shrink-0" />
      <span>{message}</span>
    </div>
  );
};
