import { finite, mean, median, standardise } from '../stats'
import { DayRow, METRIC_LABELS, METRIC_UNITS, MetricKey } from './frame'
import { WEEKDAY_NAMES } from '../time'

export interface Cluster {
  id: number
  name: string
  size: number
  share: number
  centroid: Partial<Record<MetricKey, number>>
  distinguishing: Array<{ metric: MetricKey; label: string; value: number; unit: string; z: number }>
  weekdayMix: Array<{ weekday: string; count: number }>
  dates: string[]
}

export interface ClusterResult {
  k: number
  silhouette: number
  features: MetricKey[]
  clusters: Cluster[]
  assignments: Array<{ date: string; cluster: number }>
}

const FEATURES: MetricKey[] = ['steps', 'activeMinutes', 'sleepMinutes', 'restingHeartRate', 'hrv']
const MIN_DAYS = 14
const K_RANGE = [2, 3, 4]
const MAX_ITER = 60

// A fixed seed, so the same data always produces the same clusters. k-means
// is sensitive to where it starts, and a dashboard that renames your day
// types on every refresh is worse than no dashboard.
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function distance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

// k-means++ seeding. The first centre is random, then later ones prefer
// points far from whatever has already been chosen. Converges far more
// reliably than picking k points uniformly.
function seedCentroids(rows: number[][], k: number, rand: () => number): number[][] {
  const centroids = [rows[Math.floor(rand() * rows.length)]]
  while (centroids.length < k) {
    const squaredGap = rows.map((r) => Math.min(...centroids.map((c) => distance(r, c))) ** 2)
    const total = squaredGap.reduce((s, v) => s + v, 0)
    if (total === 0) break
    let target = rand() * total
    let pick = 0
    for (let i = 0; i < squaredGap.length; i++) {
      target -= squaredGap[i]
      if (target <= 0) {
        pick = i
        break
      }
    }
    centroids.push(rows[pick])
  }
  return centroids.map((c) => [...c])
}

function runKMeans(rows: number[][], k: number, seed: number) {
  const rand = seededRandom(seed)
  let centroids = seedCentroids(rows, k, rand)
  const labels = new Array<number>(rows.length).fill(0)

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let moved = false
    rows.forEach((row, i) => {
      let best = 0
      let bestDist = Infinity
      centroids.forEach((c, j) => {
        const d = distance(row, c)
        if (d < bestDist) {
          bestDist = d
          best = j
        }
      })
      if (labels[i] !== best) moved = true
      labels[i] = best
    })

    centroids = centroids.map((prev, j) => {
      const members = rows.filter((_, i) => labels[i] === j)
      if (!members.length) return prev
      return prev.map((_, d) => mean(members.map((m) => m[d])))
    })

    if (!moved) break
  }

  return { labels, centroids }
}

// Mean silhouette width, how much closer each day sits to its own cluster
// than to the next nearest one. Running it for k of 2, 3 and 4 and keeping
// the best is how k gets chosen rather than guessed.
function silhouette(rows: number[][], labels: number[], k: number): number {
  if (k < 2) return 0
  const scores: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const own = rows.filter((_, j) => labels[j] === labels[i] && j !== i)
    if (!own.length) continue
    const a = mean(own.map((r) => distance(rows[i], r)))
    let b = Infinity
    for (let c = 0; c < k; c++) {
      if (c === labels[i]) continue
      const other = rows.filter((_, j) => labels[j] === c)
      if (!other.length) continue
      b = Math.min(b, mean(other.map((r) => distance(rows[i], r))))
    }
    if (!Number.isFinite(b)) continue
    scores.push((b - a) / Math.max(a, b))
  }
  return scores.length ? mean(scores) : 0
}

const CLUSTER_NAMES: Record<MetricKey, [string, string]> = {
  steps: ['High mileage days', 'Sedentary days'],
  activeMinutes: ['Hard training days', 'Light days'],
  calories: ['High burn days', 'Low burn days'],
  distance: ['Long distance days', 'Short distance days'],
  sleepMinutes: ['Well rested days', 'Short sleep days'],
  restingHeartRate: ['Elevated strain days', 'Deeply recovered days'],
  hrv: ['Strong recovery days', 'Suppressed recovery days'],
  spo2: ['High oxygen days', 'Low oxygen days'],
  heartRate: ['Elevated heart rate days', 'Calm heart rate days'],
}

// Names come from whichever standardised feature sits furthest from the
// overall average, so the label says what actually sets the group apart
// instead of being Cluster 1, 2 and 3.
function nameCluster(distinguishing: Cluster['distinguishing']): string {
  const top = distinguishing[0]
  if (!top) return 'Typical days'
  return CLUSTER_NAMES[top.metric][top.z > 0 ? 0 : 1]
}

export function clusterDays(frame: DayRow[]): ClusterResult | null {
  const usable = frame.filter((d) => FEATURES.filter((f) => d.values[f] != null).length >= 3)
  if (usable.length < MIN_DAYS) return null

  // A missing feature is filled with that feature's median so one absent
  // night does not throw an otherwise complete day out of the model.
  const medians = Object.fromEntries(
    FEATURES.map((f) => [f, median(finite(usable.map((d) => d.values[f] ?? null)))])
  ) as Record<MetricKey, number>

  const columns = FEATURES.map((f) => usable.map((d) => d.values[f] ?? medians[f]))
  if (columns.some((c) => c.some((v) => !Number.isFinite(v)))) return null

  const { z } = standardise(columns)
  const rows = usable.map((_, i) => FEATURES.map((__, j) => z[j][i]))

  let best: { k: number; labels: number[]; centroids: number[][]; score: number } | null = null
  for (const k of K_RANGE) {
    if (rows.length < k * 3) continue
    const { labels, centroids } = runKMeans(rows, k, 42)
    const score = silhouette(rows, labels, k)
    if (!best || score > best.score) best = { k, labels, centroids, score }
  }
  if (!best) return null

  const chosen = best

  const clusters: Cluster[] = chosen.centroids.map((centroid, id) => {
    const memberIdx = chosen.labels.map((l, i) => (l === id ? i : -1)).filter((i) => i >= 0)

    const distinguishing = FEATURES.map((metric, j) => ({
      metric,
      label: METRIC_LABELS[metric],
      unit: METRIC_UNITS[metric],
      z: centroid[j],
      value: mean(memberIdx.map((i) => columns[j][i])),
    }))
      .filter((d) => Number.isFinite(d.z))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))

    const weekdayCounts = new Array<number>(7).fill(0)
    memberIdx.forEach((i) => weekdayCounts[usable[i].weekday]++)

    return {
      id,
      name: nameCluster(distinguishing),
      size: memberIdx.length,
      share: memberIdx.length / usable.length,
      centroid: Object.fromEntries(
        FEATURES.map((f, j) => [f, mean(memberIdx.map((i) => columns[j][i]))])
      ) as Partial<Record<MetricKey, number>>,
      distinguishing: distinguishing.slice(0, 3),
      weekdayMix: weekdayCounts.map((count, i) => ({ weekday: WEEKDAY_NAMES[i], count })),
      dates: memberIdx.map((i) => usable[i].date),
    }
  })

  return {
    k: chosen.k,
    silhouette: chosen.score,
    features: FEATURES,
    clusters: clusters.sort((a, b) => b.size - a.size),
    assignments: usable.map((d, i) => ({ date: d.date, cluster: chosen.labels[i] })),
  }
}
