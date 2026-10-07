import { DayRow, METRIC_LABELS, MetricKey, interpolate, series } from './frame'
import { seededRandom, standardise } from '../stats'

// An isolation forest over the whole daily vector. The z-score layer looks at
// one metric at a time, so it can only ever flag a day where something was
// individually extreme. It cannot see a day where every number is ordinary on
// its own and the combination is not, which is what a day of high steps on no
// sleep and a flat heart rate looks like. This finds those, by exploiting the
// fact that an unusual point takes fewer random splits to cut off from
// everything else than a crowded one does.
const TREES = 160
const SAMPLE = 64
const FOREST_METRICS: MetricKey[] = [
  'steps',
  'activeMinutes',
  'sleepMinutes',
  'restingHeartRate',
  'hrv',
]
const MIN_DAYS = 24

// 0.5 is the score of an average point by construction, so a threshold has to
// sit above it. 0.6 is the usual convention for "more isolated than the data
// explains". Measured against the 120 day seeded history that lands just above
// the 95th percentile, which was 0.564, and flags the two days that were
// genuinely unusual rather than merely at the edge of one metric.
const FLAG_SCORE = 0.6
const MAX_FLAGGED = 6

interface Node {
  feature: number
  split: number
  left: Node | null
  right: Node | null
  size: number
  depth: number
}

export interface CombinationAnomaly {
  date: string
  score: number
  pathLength: number
  contributors: Array<{ metric: MetricKey; label: string; z: number }>
}

export interface ForestResult {
  metrics: MetricKey[]
  trees: number
  sampleSize: number
  threshold: number
  scores: Array<{ date: string; score: number }>
  flagged: CombinationAnomaly[]
  n: number
}

// The average path length of an unsuccessful search in a binary search tree of
// n points. Without this normalisation a score is only comparable between
// points inside one tree of one size, which makes the whole forest useless.
function expectedPathLength(n: number): number {
  if (n <= 1) return 0
  if (n === 2) return 1
  const euler = 0.5772156649
  return 2 * (Math.log(n - 1) + euler) - (2 * (n - 1)) / n
}

function build(rows: number[][], depth: number, limit: number, rand: () => number): Node {
  if (depth >= limit || rows.length <= 1) {
    return { feature: -1, split: 0, left: null, right: null, size: rows.length, depth }
  }
  const d = rows[0].length
  // Only features that actually vary in this subsample are candidates. Splitting
  // on a constant column sends every row one way and wastes a level of depth,
  // which inflates every path length through that branch.
  const usable: number[] = []
  for (let f = 0; f < d; f++) {
    let lo = Infinity
    let hi = -Infinity
    for (const row of rows) {
      if (row[f] < lo) lo = row[f]
      if (row[f] > hi) hi = row[f]
    }
    if (hi > lo) usable.push(f)
  }
  if (usable.length === 0) {
    return { feature: -1, split: 0, left: null, right: null, size: rows.length, depth }
  }

  const feature = usable[Math.floor(rand() * usable.length)]
  let lo = Infinity
  let hi = -Infinity
  for (const row of rows) {
    if (row[feature] < lo) lo = row[feature]
    if (row[feature] > hi) hi = row[feature]
  }
  const split = lo + rand() * (hi - lo)
  const left = rows.filter((r) => r[feature] < split)
  const right = rows.filter((r) => r[feature] >= split)

  return {
    feature,
    split,
    size: rows.length,
    depth,
    left: build(left, depth + 1, limit, rand),
    right: build(right, depth + 1, limit, rand),
  }
}

function pathLength(node: Node, row: number[]): number {
  let current = node
  let length = 0
  while (current.feature >= 0) {
    length++
    const next = row[current.feature] < current.split ? current.left : current.right
    if (!next) break
    current = next
  }
  // A leaf reached because the depth limit ran out still has points under it, so
  // the remaining depth is charged as the average search length for that many
  // points rather than treated as zero.
  return length + expectedPathLength(current.size)
}

export function isolationForest(frame: DayRow[]): ForestResult | null {
  const columns = FOREST_METRICS.map((m) => interpolate(series(frame, m), 2))
  const rows: number[][] = []
  const dates: string[] = []
  frame.forEach((day, i) => {
    const row = columns.map((c) => c[i])
    if (row.some((v) => v == null)) return
    rows.push(row as number[])
    dates.push(day.date)
  })
  if (rows.length < MIN_DAYS) return null

  const byColumn = FOREST_METRICS.map((_, d) => rows.map((r) => r[d]))
  const { z } = standardise(byColumn)
  const x = rows.map((_, i) => z.map((col) => col[i]))

  const rand = seededRandom(2718)
  const sampleSize = Math.min(SAMPLE, x.length)
  const limit = Math.ceil(Math.log2(Math.max(2, sampleSize)))
  const forest: Node[] = []
  for (let t = 0; t < TREES; t++) {
    const subsample: number[][] = []
    for (let i = 0; i < sampleSize; i++) subsample.push(x[Math.floor(rand() * x.length)])
    forest.push(build(subsample, 0, limit, rand))
  }

  const norm = expectedPathLength(sampleSize)
  const scores = x.map((row, i) => {
    let total = 0
    for (const tree of forest) total += pathLength(tree, row)
    const average = total / forest.length
    return {
      date: dates[i],
      score: norm > 0 ? Math.pow(2, -average / norm) : 0.5,
      pathLength: average,
      row,
    }
  })

  const flagged = scores
    .filter((s) => s.score >= FLAG_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FLAGGED)
    .map((s) => ({
      date: s.date,
      score: s.score,
      pathLength: s.pathLength,
      contributors: s.row
        .map((v, d) => ({ metric: FOREST_METRICS[d], label: METRIC_LABELS[FOREST_METRICS[d]], z: v }))
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
        .slice(0, 3),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  return {
    metrics: FOREST_METRICS,
    trees: TREES,
    sampleSize,
    threshold: FLAG_SCORE,
    scores: scores.map((s) => ({ date: s.date, score: s.score })),
    flagged,
    n: x.length,
  }
}
