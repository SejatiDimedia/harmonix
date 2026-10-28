import React, { useEffect } from 'react';
import { Trash2, AlertTriangle, X, Loader2 } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  sessionTitle?: string;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  sessionTitle,
  isDeleting = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isDeleting) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200 no-print print:hidden"
      onClick={isDeleting ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      aria-describedby="delete-modal-desc"
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-[#1c1b18] border border-[#2e2c28] p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          disabled={isDeleting}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[#8e8b82] hover:text-[#f5f4ef] hover:bg-[#262421] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Tutup dialog konfirmasi hapus (Esc)"
          title="Tutup (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header with Danger Icon */}
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/40 text-rose-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1 pr-6">
            <h3 id="delete-modal-title" className="text-base font-semibold text-[#f5f4ef] font-sans">
              Hapus Riwayat Percakapan?
            </h3>
            <p id="delete-modal-desc" className="text-xs text-[#9c9990] leading-relaxed">
              Tindakan ini tidak dapat dibatalkan. Seluruh riwayat analisis, kueri SQL, dan widget dashboard terkait akan dihapus secara permanen.
            </p>
          </div>
        </div>

        {/* Selected Session Highlight Box */}
        <div className="rounded-xl bg-[#141311] border border-[#262421] p-3 text-xs font-mono text-clay-300 flex items-center gap-2.5">
          <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="truncate font-sans font-medium text-[#dedcd5]">
            "{sessionTitle || 'Percakapan ini'}"
          </span>
        </div>

        {/* Actions Footer */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#262421]">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#dedcd5] bg-[#201f1d] hover:bg-[#282623] border border-[#383632] hover:border-[#48453f] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 transition shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Menghapus...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Percakapan</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
