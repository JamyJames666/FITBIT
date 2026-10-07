#!/bin/sh
set -e

echo "Pulse Engine starting"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set, refusing to start"
  exit 1
fi

# Applies the schema without the destructive flag. If a change needs a column
# dropped, run that deliberately rather than letting every container boot do it.
echo "Applying schema"
node_modules/.bin/prisma db push

echo "Serving on port ${PORT:-3000}"
exec node server.js
