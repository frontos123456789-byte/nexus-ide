/**
 * Priority chain of FREE OpenRouter models.
 * Only ids ending in ":free" (plus the official free router "openrouter/free")
 * are ever allowed to reach the network — see `isFreeModel`.
 */

export interface ModelSpec {
  id: string;
  /** Human-readable name shown in the UI ("Переключение на Nemotron…"). */
  label: string;
  vendor: string;
}

export const FREE_MODEL_CHAIN: readonly ModelSpec[] = [
  { id: "recursive/flint-v1.0:free", label: "Flint v1.0", vendor: "Recursive" },
  { id: "cohere/north-mini-code:free", label: "North Mini Code", vendor: "Cohere" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra", vendor: "NVIDIA" },
  { id: "thinkingmachines/inkling-small:free", label: "Inkling Small", vendor: "Thinking Machines" },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", vendor: "Google" },
  { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning", vendor: "NVIDIA" },
  { id: "openrouter/free", label: "OpenRouter Free", vendor: "OpenRouter" },
];

export function isFreeModel(id: string): boolean {
  return id.endsWith(":free") || id === "openrouter/free";
}

export function getModelLabel(id: string): string {
  return FREE_MODEL_CHAIN.find((m) => m.id === id)?.label ?? id;
}

/**
 * Returns the chain to walk. A preferred model (if known) is moved to the
 * front while preserving the relative order of the rest.
 * Non-free models are always filtered out.
 */
export function resolveChain(preferred?: string, chain: readonly ModelSpec[] = FREE_MODEL_CHAIN): ModelSpec[] {
  const free = chain.filter((m) => isFreeModel(m.id));
  if (!preferred) return free;
  const first = free.find((m) => m.id === preferred);
  if (!first) return free;
  return [first, ...free.filter((m) => m.id !== preferred)];
}
