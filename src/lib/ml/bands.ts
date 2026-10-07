// Dependency-free so client components can import it without pulling Prisma
// into the browser bundle.
export type ReadinessBand = 'rest' | 'easy' | 'steady' | 'push'

export const BAND_COPY: Record<ReadinessBand, { title: string; advice: string }> = {
  rest: {
    title: 'Rest',
    advice: 'Your signals are well below your own baseline. Take the day off or keep it very light.',
  },
  easy: {
    title: 'Easy',
    advice: 'Something is off baseline. Move, but keep it conversational and short.',
  },
  steady: {
    title: 'Steady',
    advice: "You're in your normal range. A regular session is well within reach.",
  },
  push: {
    title: 'Push',
    advice: 'Recovery markers are above your baseline. This is the day to go hard.',
  },
}

// Readiness is a magnitude, so the band colours step one hue rather than
// running through a traffic-light sequence. Only the bottom band borrows a
// status colour, because "stop" is genuinely a status.
export const BAND_COLOR: Record<ReadinessBand, string> = {
  rest: 'var(--critical)',
  easy: 'var(--series-7)',
  steady: 'var(--series-1)',
  push: 'var(--series-3)',
}

export const SEVERITY_COLOR: Record<'watch' | 'notable' | 'extreme', string> = {
  watch: 'var(--warning)',
  notable: 'var(--serious)',
  extreme: 'var(--critical)',
}
