#!/bin/sh
echo "=== Health Tracker: container started ==="
echo "=== DATABASE_URL present: $([ -n "$DATABASE_URL" ] && echo YES || echo NO - CHECK ENV VARS) ==="

echo "=== Running DB migration ==="
node_modules/.bin/prisma db push --accept-data-loss 2>&1 || echo "WARNING: DB push failed, server will still start"

echo "=== Starting Next.js on port ${PORT:-3000} ==="
exec node server.js
