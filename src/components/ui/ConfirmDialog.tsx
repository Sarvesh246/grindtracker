'use client'
import Dialog from './Dialog'
import Button from './Button'

/** Small reusable confirm/cancel sheet, built on the shared Dialog primitive. */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      role="alertdialog"
      labelledBy="confirm-dialog-title"
      describedBy="confirm-dialog-message"
      zIndex={340}
      style={{ alignItems: 'center' }}
      panelStyle={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px',
        maxWidth: '360px',
        margin: '0 16px',
      }}
    >
      <h2
        id="confirm-dialog-title"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '20px',
          letterSpacing: '0.5px',
          color: 'var(--text-primary)',
          margin: '0 0 8px',
        }}
      >
        {title}
      </h2>
      <p
        id="confirm-dialog-message"
        style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 20px' }}
      >
        {message}
      </p>
      <div style={{ display: 'flex', gap: '10px' }}>
        <Button
          variant="secondary"
          haptic="light"
          onClick={onCancel}
          disabled={busy}
          style={{ flex: 1 }}
        >
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          haptic={danger ? 'heavy' : 'medium'}
          onClick={onConfirm}
          disabled={busy}
          style={{ flex: 1 }}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
