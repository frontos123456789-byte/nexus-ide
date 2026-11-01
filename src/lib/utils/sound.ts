/**
 * Tiny WebAudio sound engine — no audio assets required.
 * Sounds are opt-in (toggle in the status bar / command palette).
 */

export type SoundKind = "send" | "done" | "error" | "switch" | "toggle";

interface Tone {
  freq: number;
  start: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

const PATTERNS: Record<SoundKind, Tone[]> = {
  send: [{ freq: 660, start: 0, duration: 0.07, type: "sine", gain: 0.05 }],
  done: [
    { freq: 523.25, start: 0, duration: 0.11, type: "sine", gain: 0.06 },
    { freq: 783.99, start: 0.1, duration: 0.18, type: "sine", gain: 0.06 },
  ],
  error: [
    { freq: 220, start: 0, duration: 0.14, type: "triangle", gain: 0.07 },
    { freq: 164.81, start: 0.13, duration: 0.2, type: "triangle", gain: 0.07 },
  ],
  switch: [
    { freq: 440, start: 0, duration: 0.06, type: "square", gain: 0.025 },
    { freq: 554.37, start: 0.07, duration: 0.06, type: "square", gain: 0.025 },
  ],
  toggle: [{ freq: 880, start: 0, duration: 0.05, type: "sine", gain: 0.04 }],
};

let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

export function playSound(kind: SoundKind, force = false): void {
  if (!enabled && !force) return;
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  for (const tone of PATTERNS[kind]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = tone.type ?? "sine";
    osc.frequency.value = tone.freq;
    const peak = tone.gain ?? 0.05;
    gain.gain.setValueAtTime(0.0001, now + tone.start);
    gain.gain.exponentialRampToValueAtTime(peak, now + tone.start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + tone.start);
    osc.stop(now + tone.start + tone.duration + 0.02);
  }
}
