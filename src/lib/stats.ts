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

// Cholesky decomposition of a symmetric positive definite matrix, returning the
// lower triangular L with A = L Lt. Returns null rather than NaN when A turns
// out not to be positive definite, which is how the GP detects that its noise
// floor is too low and needs raising.
export function cholesky(a: number[][]): number[][] | null {
  const n = a.length
  const l: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j]
      for (let k = 0; k < j; k++) sum -= l[i][k] * l[j][k]
      if (i === j) {
        if (!(sum > 0)) return null
        l[i][j] = Math.sqrt(sum)
      } else {
        l[i][j] = sum / l[j][j]
      }
    }
  }
  return l
}

// Solves L Lt x = b given the Cholesky factor, by one forward and one back
// substitution. Never forms an inverse, which is both slower and less stable.
export function cholSolve(l: number[][], b: number[]): number[] {
  const n = l.length
  const y = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let sum = b[i]
    for (let k = 0; k < i; k++) sum -= l[i][k] * y[k]
    y[i] = sum / l[i][i]
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]
    for (let k = i + 1; k < n; k++) sum -= l[k][i] * x[k]
    x[i] = sum / l[i][i]
  }
  return x
}

// Log determinant from a Cholesky factor, twice the sum of the log diagonal.
// Needed by the GP's marginal likelihood and prone to overflow if computed as
// a product first.
export function cholLogDet(l: number[][]): number {
  let sum = 0
  for (let i = 0; i < l.length; i++) sum += Math.log(l[i][i])
  return 2 * sum
}

// Cyclic Jacobi eigendecomposition for a small symmetric matrix, returning
// eigenvalues descending with their eigenvectors as columns. Jacobi rather than
// QR because the matrices here are at most 8x8 and it needs no pivoting or
// tridiagonal reduction to stay accurate.
export function jacobiEigen(
  input: number[][],
  sweeps = 60,
): { values: number[]; vectors: number[][] } {
  const n = input.length
  const a = input.map((r) => [...r])
  let v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  )
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]
    if (off < 1e-14) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[y][y] - a[x][x])
  return {
    values: order.map((i) => a[i][i]),
    vectors: v.map((row) => order.map((i) => row[i])),
  }
}

// Covariance matrix of column-major data, with the n-1 denominator.
export function covariance(columns: number[][]): number[][] {
  const d = columns.length
  const n = columns[0]?.length ?? 0
  const centres = columns.map(mean)
  const out: number[][] = Array.from({ length: d }, () => new Array(d).fill(0))
  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      let sum = 0
      for (let k = 0; k < n; k++) sum += (columns[i][k] - centres[i]) * (columns[j][k] - centres[j])
      const cov = n > 1 ? sum / (n - 1) : 0
      out[i][j] = cov
      out[j][i] = cov
    }
  }
  return out
}

// Mulberry32. Every model that samples needs a fixed seed, so a refresh with no
// new data cannot renumber clusters or reshuffle a forest.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
