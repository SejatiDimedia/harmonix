import React from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { Modal, Button, Card } from './ui';

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
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      size="sm"
      icon={<AlertTriangle className="w-5 h-5 text-rose-400" />}
      title="Hapus Riwayat Percakapan?"
      subtitle="Tindakan ini tidak dapat dibatalkan"
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isDeleting}>
            Batal
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirm}
            isLoading={isDeleting}
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Hapus Percakapan
          </Button>
        </div>
      }
    >
      <div className="space-y-3 font-sans">
        <p className="text-xs text-slate-400 leading-relaxed">
          Seluruh riwayat analisis, kueri SQL, dan widget dashboard terkait sesi ini akan dihapus secara permanen dari basis data PostgreSQL.
        </p>

        <Card variant="dark" className="p-3 flex items-center gap-2.5">
          <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="truncate text-xs font-medium text-white">
            &quot;{sessionTitle || 'Percakapan ini'}&quot;
          </span>
        </Card>
      </div>
    </Modal>
  );
};
