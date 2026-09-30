import * as Dialog from '@radix-ui/react-dialog';
import { X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
export function IconButton({
  icon: Icon,
  label,
  onClick,
  className = '',
  ...props
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...props}
    >
      <Icon size={17} />
    </button>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${className}`}
          aria-describedby={description ? 'dialog-description' : undefined}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} label="Close" />
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description id="dialog-description" className="modal-description">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function DeckMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="18" height="25" rx="4" transform="rotate(-15 4 7)" fill="#827293" />
      <rect x="15" y="4" width="18" height="25" rx="4" transform="rotate(9 15 4)" fill="#c4afe4" />
      <path d="m20 13 6 4-6 3z" fill="#39303f" />
    </svg>
  );
}
