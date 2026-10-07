import { prisma } from './prisma'

// Health Connect reports the same walk twice when the Fitbit wearable and the
// phone's own pedometer both see it, as separate and often overlapping
// DataPoint rows. Summing across them double-counts. The wearable is the
// better record, so it wins whenever it has any data for the window, and
// anything else is used only when the wearable reported nothing at all.
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
