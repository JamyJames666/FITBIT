import { prisma } from './prisma'

// Health Connect surfaces the same real-world activity from multiple sources
// (the Fitbit wearable AND the phone's own pedometer/HealthKit) as separate,
// often time-overlapping DataPoint rows. Summing/averaging across all of
// them double-counts steps/distance/etc. Fitbit is the primary wearable, so
// prefer it whenever it has any data for the window; only fall back to
// whatever else is present when Fitbit reported nothing at all.
const PREFERRED_SOURCE = 'FITBIT'

export async function resolvePreferredSource(
  dataType: string,
  since: Date | null,
  until: Date
): Promise<string | undefined> {
  const hasPreferred = await prisma.dataPoint.findFirst({
    where: {
      dataType,
      source: PREFERRED_SOURCE,
      ...(since ? { startTime: { gte: since, lt: until } } : {}),
    },
    select: { id: true },
  })
  return hasPreferred ? PREFERRED_SOURCE : undefined
}
