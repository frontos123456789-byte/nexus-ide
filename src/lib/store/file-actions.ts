import { toast } from "sonner";
import { normalizePath, validateName } from "@/lib/utils/path";
import { confirmAction, promptAction } from "./dialogs";
import { useIdeStore } from "./ide";

function validatePathInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Введите имя";
  if (trimmed.endsWith("/")) return "Укажите имя после последнего «/»";
  for (const segment of trimmed.replace(/\\/g, "/").split("/").filter(Boolean)) {
    const problem = validateName(segment);
    if (problem) return problem;
  }
  if (useIdeStore.getState().nodes[normalizePath(trimmed)]) return "Такой путь уже существует";
  return null;
}

function reportError(prefix: string, err: unknown): void {
  toast.error(prefix, { description: err instanceof Error ? err.message : String(err) });
}

export async function promptNewFile(dir = ""): Promise<void> {
  const value = await promptAction({
    title: "Новый файл",
    description: dir ? `Папка: /${dir}` : "Корень проекта. Можно указать вложенный путь: src/utils/helper.ts",
    placeholder: "example.ts",
    initial: dir ? `${dir}/` : "",
    validate: validatePathInput,
  });
  if (!value) return;
  try {
    await useIdeStore.getState().createFile(normalizePath(value));
  } catch (err) {
    reportError("Не удалось создать файл", err);
  }
}

export async function promptNewFolder(dir = ""): Promise<void> {
  const value = await promptAction({
    title: "Новая папка",
    description: dir ? `Родитель: /${dir}` : "Корень проекта",
    placeholder: "components",
    initial: dir ? `${dir}/` : "",
    validate: validatePathInput,
  });
  if (!value) return;
  try {
    await useIdeStore.getState().createFolder(normalizePath(value));
  } catch (err) {
    reportError("Не удалось создать папку", err);
  }
}

export async function confirmDelete(path: string): Promise<void> {
  const node = useIdeStore.getState().nodes[path];
  if (!node) return;
  const ok = await confirmAction({
    title: `Удалить «${path}»?`,
    description:
      node.type === "folder"
        ? "Папка и всё её содержимое будут удалены без возможности восстановления."
        : "Файл будет удалён без возможности восстановления.",
    confirmLabel: "Удалить",
    destructive: true,
  });
  if (!ok) return;
  try {
    await useIdeStore.getState().deleteEntry(path);
  } catch (err) {
    reportError("Не удалось удалить", err);
  }
}

export async function confirmResetWorkspace(): Promise<void> {
  const ok = await confirmAction({
    title: "Сбросить рабочее пространство?",
    description: "Все ваши файлы будут удалены и заменены демо-проектом. История агентов останется.",
    confirmLabel: "Сбросить",
    destructive: true,
  });
  if (!ok) return;
  try {
    await useIdeStore.getState().resetWorkspace();
    toast.success("Рабочее пространство сброшено");
  } catch (err) {
    reportError("Не удалось сбросить", err);
  }
}

export async function renameTo(from: string, to: string): Promise<boolean> {
  try {
    await useIdeStore.getState().renameEntry(from, to);
    return true;
  } catch (err) {
    reportError("Не удалось переименовать", err);
    return false;
  }
}
