// Standalone sync entrypoint, run via `npm run sync` from a cron job, so
// pulling new data doesn't depend on the web server being hit.
import 'dotenv/config'
import { syncAllDataTypes } from '../src/lib/googleHealth'

const DEFAULT_SINCE_DAYS = 30

async function main() {
  const since = new Date(Date.now() - DEFAULT_SINCE_DAYS * 86_400_000)
  const results = await syncAllDataTypes(since)
  console.log(JSON.stringify(results, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
