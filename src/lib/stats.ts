// Dependency-free numeric helpers shared by the model layer. No imports so
// both server routes and client components can use them.

export function mean(xs: number[]): number {
  if (!xs.length) return NaN
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) ** 2
  return Math.sqrt(s / (xs.length - 1))
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN
  return quantile([...xs].sort((a, b) => a - b), 0.5)
}

// Median absolute deviation, scaled so that for normally distributed data it
// estimates the same quantity as the standard deviation. Unlike sd it is not
// dragged around by the outlier it is being used to detect.
const MAD_TO_SIGMA = 1.4826

export function mad(xs: number[]): number {
  if (xs.length < 2) return NaN
  const m = median(xs)
  return MAD_TO_SIGMA * median(xs.map((x) => Math.abs(x - m)))
}

// Exponentially weighted moving average. alpha near 1 tracks the latest
// reading, near 0 holds the long-run level.
export function ewma(xs: number[], alpha: number): number[] {
  const out: number[] = []
  let level = NaN
  for (const x of xs) {
    level = Number.isNaN(level) ? x : alpha * x + (1 - alpha) * level
    out.push(level)
  }
  return out
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function finite(xs: Array<number | null | undefined>): number[] {
  return xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
}

// Ordinary least squares on a single predictor.
export function linreg(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = Math.min(x.length, y.length)
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN }
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  const slope = sxx === 0 ? 0 : sxy / sxx
  return { slope, intercept: my - slope * mx, r2: sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy) }
}

export function zScore(value: number, centre: number, scale: number): number {
  if (!Number.isFinite(scale) || scale === 0) return 0
  return (value - centre) / scale
}

// Standardise each column to mean 0, sd 1 so ridge penalises every predictor
// on the same footing regardless of its native units.
export function standardise(columns: number[][]): { z: number[][]; centres: number[]; scales: number[] } {
  const centres = columns.map(mean)
  const scales = columns.map((c) => {
    const s = stdev(c)
    return Number.isFinite(s) && s > 0 ? s : 1
  })
  return { z: columns.map((c, j) => c.map((v) => (v - centres[j]) / scales[j])), centres, scales }
}
