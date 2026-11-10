import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

let toastSeq = 0;
let toasts: ToastItem[] = [];
const toastListeners = new Set<(items: ToastItem[]) => void>();

function publishToasts(): void {
  for (const listener of toastListeners) listener(toasts);
}

export function toast(text: string, kind: ToastKind = 'info'): void {
  const item: ToastItem = { id: ++toastSeq, kind, text };
  toasts = [...toasts, item];
  publishToasts();
  window.setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== item.id);
      publishToasts();
    },
    kind === 'error' ? 7000 : 3500,
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>(toasts);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => {
      toastListeners.delete(setItems);
    };
  }, []);
  return (
    <div class="toast-host" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} class={`toast ${item.kind}`} dir="auto">
          {item.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog (promise based; avoids blocking native dialogs)
// ---------------------------------------------------------------------------

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

let confirmState: ConfirmState | null = null;
const confirmListeners = new Set<(state: ConfirmState | null) => void>();

function publishConfirm(): void {
  for (const listener of confirmListeners) listener(confirmState);
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (confirmState) confirmState.resolve(false);
    confirmState = { ...options, resolve };
    publishConfirm();
  });
}

export function ConfirmHost() {
  const [state, setState] = useState<ConfirmState | null>(confirmState);
  useEffect(() => {
    confirmListeners.add(setState);
    return () => {
      confirmListeners.delete(setState);
    };
  }, []);
  if (!state) return null;
  const finish = (value: boolean) => {
    state.resolve(value);
    confirmState = null;
    publishConfirm();
  };
  return (
    <Modal title={state.title} onClose={() => finish(false)}>
      <div class="modal-body">
        <p class="pre-wrap" dir="auto">
          {state.message}
        </p>
      </div>
      <div class="modal-foot">
        <button class="btn" onClick={() => finish(false)}>
          {state.cancelLabel ?? 'Cancel'}
        </button>
        <button
          class={`btn ${state.danger ? 'danger' : 'primary'}`}
          data-autofocus
          onClick={() => finish(true)}
        >
          {state.confirmLabel ?? 'OK'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ComponentChildren;
}

export function Modal({ title, onClose, wide, children }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const auto = document.querySelector<HTMLElement>('.modal [data-autofocus]');
    auto?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div
      class="modal-backdrop no-print"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div class={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div class="modal-head">
          <h2 dir="auto">{title}</h2>
          <button class="btn ghost icon right" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

/** Hidden file input behind a normal button. */
export function FileButton(props: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  class?: string;
  disabled?: boolean;
}) {
  return (
    <label class={`btn ${props.class ?? ''}`} aria-disabled={props.disabled}>
      {props.label}
      <input
        type="file"
        accept={props.accept}
        class="hidden"
        disabled={props.disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          input.value = '';
          if (file) props.onFile(file);
        }}
      />
    </label>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
