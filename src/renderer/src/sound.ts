/**
 * Tiny synthesized sound effects (Web Audio, no files). Off by default;
 * toggled with the speaker button in the top bar.
 */
let enabled = false
let ctx: AudioContext | null = null

export function setSoundEnabled(on: boolean): void {
  enabled = on
}

type Effect = 'correct' | 'wrong' | 'click' | 'win' | 'pop'

const NOTES: Record<Effect, { freqs: number[]; dur: number; type: OscillatorType }> = {
  correct: { freqs: [660, 880], dur: 0.09, type: 'sine' },
  wrong: { freqs: [200, 150], dur: 0.12, type: 'square' },
  click: { freqs: [1200], dur: 0.03, type: 'triangle' },
  pop: { freqs: [520], dur: 0.05, type: 'sine' },
  win: { freqs: [523, 659, 784, 1046], dur: 0.12, type: 'sine' }
}

export function play(effect: Effect): void {
  if (!enabled) return
  try {
    ctx ??= new AudioContext()
    const { freqs, dur, type } = NOTES[effect]
    let t = ctx.currentTime
    for (const f of freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.08, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur)
      t += dur * 0.9
    }
  } catch {
    // Audio is optional; ignore failures.
  }
}
