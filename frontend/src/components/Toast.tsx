import React from 'react';

interface ToastProps {
  message: string | null;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-bounce flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#201f1d] border border-clay-500/40 text-xs text-[#f5f4ef] shadow-2xl font-mono">
      <span className="w-2 h-2 rounded-full bg-clay-500 animate-ping" />
      <span>{message}</span>
    </div>
  );
};
