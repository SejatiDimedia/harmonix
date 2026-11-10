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
      title="Delete Conversation Session?"
      subtitle="This action cannot be undone"
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirm}
            isLoading={isDeleting}
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Delete Conversation
          </Button>
        </div>
      }
    >
      <div className="space-y-3 font-sans">
        <p className="text-xs text-slate-400 leading-relaxed">
          All analytical turns, executed SQL queries, and pinned dashboard widgets for this session will be permanently deleted from the PostgreSQL database.
        </p>

        <Card variant="dark" className="p-3 flex items-center gap-2.5">
          <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="truncate text-xs font-medium text-white">
            &quot;{sessionTitle || 'This conversation'}&quot;
          </span>
        </Card>
      </div>
    </Modal>
  );
};
