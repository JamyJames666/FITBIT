// All day-boundary logic goes through a real IANA zone rather than a fixed
// minute offset, so local midnight stays correct across a DST change.
export const TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || 'Europe/London'

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    partsCache.set(timeZone, f)
  }
  return f
}

function zonedParts(date: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

// The zone's UTC offset in minutes at a given instant, derived by comparing
// the wall-clock reading in that zone against the same instant in UTC.
export function offsetMinutes(date: Date, timeZone = TIME_ZONE): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000)
}

// The local calendar date at an instant, as YYYY-MM-DD.
export function localDateKey(date: Date, timeZone = TIME_ZONE): string {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// The UTC instant at which a local calendar date begins. The offset is
// resolved twice because the offset that applies after midnight is the one
// that matters, and on a DST boundary the first guess can land on the wrong
// side of the change.
export function startOfLocalDate(dateKey: string, timeZone = TIME_ZONE): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d)
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000)
  return new Date(naive - offsetMinutes(firstGuess, timeZone) * 60_000)
}

export function startOfToday(timeZone = TIME_ZONE): Date {
  return startOfLocalDate(localDateKey(new Date(), timeZone), timeZone)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

// Monday = 0 through Sunday = 6, which keeps weekends adjacent at the end of
// the week rather than split across both ends.
export function weekdayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
