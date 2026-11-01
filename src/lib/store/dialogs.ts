import { create } from "zustand";

interface ConfirmRequest {
  kind: "confirm";
  title: string;
  description?: string;
  confirmLabel: string;
  destructive: boolean;
  resolve: (ok: boolean) => void;
}

interface PromptRequest {
  kind: "prompt";
  title: string;
  description?: string;
  placeholder?: string;
  initial: string;
  confirmLabel: string;
  validate?: (value: string) => string | null;
  resolve: (value: string | null) => void;
}

type Request = ConfirmRequest | PromptRequest;

interface DialogState {
  request: Request | null;
  close: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  request: null,
  close: () => set({ request: null }),
}));

export function confirmAction(opts: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.setState({
      request: {
        kind: "confirm",
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.confirmLabel ?? "Подтвердить",
        destructive: opts.destructive ?? false,
        resolve,
      },
    });
  });
}

export function promptAction(opts: {
  title: string;
  description?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.setState({
      request: {
        kind: "prompt",
        title: opts.title,
        description: opts.description,
        placeholder: opts.placeholder,
        initial: opts.initial ?? "",
        confirmLabel: opts.confirmLabel ?? "Создать",
        validate: opts.validate,
        resolve,
      },
    });
  });
}
