# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One owner, running the whole thing for himself. A data engineer who works with warehouses, SQL and dashboards for a living, so he reads a chart faster than a sentence and distrusts a number he cannot trace. He checks it from his phone in the morning, a minute after waking, and from a desktop browser in the evening when he wants to dig.

A second audience reads the repository rather than the app: engineers arriving from the GitHub page who want to see how it is built and whether the method holds up. They never log in. What they see is the README and the code.

## Product Purpose

Pulse Engine pulls every data type the Google Health API exposes for a Fitbit-linked account, keeps it forever in Postgres, and runs a stack of models over it so the owner can answer one question each morning: given what my body has actually been doing, what should I do today.

It exists because the consumer app that ships with the wearable shows the last seven days, throws the rest away, and gives advice without showing its working. Success is a readiness verdict the owner trusts enough to change his training on, and a history long enough to see a trend the vendor's app would have deleted.

## Positioning

The data is owned, not borrowed: every raw API payload is kept alongside the parsed value, so a model written next year can be rerun over data captured today. Every statement on the screen names the method that produced it and the window it was computed over. A consumer wellness app cannot truthfully copy either, because it does not keep the history and will not show the method.

## Operating Context

The wearable syncs to Google's cloud on its own schedule, so the freshest reading is minutes to hours old and never live. A background job pulls new points on a cron; the dashboard also triggers a sync when opened. Sync is incremental per data type and capped at fourteen days per API request.

Deployed with Docker on a personal domain behind Dokploy and Traefik, gated by a single shared password. Postgres is the only store. Daily volume is tens of thousands of rows, dominated by per-minute heart rate.

## Capabilities and Constraints

- Thirty-eight Google Health data types are enumerated; three have no list endpoint and are skipped.
- Readings carry a `source`, because Health Connect records the same walk twice when the phone and the watch both see it. The wearable wins where both reported.
- Roughly a tenth of readings arrive without a value the parser recognises; the raw payload is kept regardless.
- Models run server side in TypeScript on request. There is no Python service and no training step: everything is fitted on the owner's own history each time it is asked for.
- The model stack is baselines, robust anomaly detection, a readiness composite, additive decomposition, k-means day clustering, ridge attribution and a Holt-Winters forecast.
- A model that lacks the data it needs returns nothing rather than a degraded answer. Short history is the normal state for the first month.
- Single user by construction. Connecting a Google account replaces the stored tokens.

## Brand Commitments

Named Pulse Engine. The line is "Health signals in, decisions out." It should read as instrumentation rather than as a wellness product: something that measures, not something that encourages. No streaks, no badges, no congratulation.

## Evidence on Hand

Real data for one person, currently a few months deep and growing. No second user, no benchmark cohort, no clinical validation, and nothing on the screen may imply any of the three. The models are standard published methods applied honestly to a small sample; the interface should say so where it matters rather than hide it.

## Product Principles

- Show the method with the number. A verdict that cannot be traced to a window and a formula does not ship.
- Compare a body against itself. Population norms are not the baseline; the owner's own trailing distribution is.
- Keep the raw payload. Parsing is a guess that improves; the API response is the record.
- Absent data is said out loud, never interpolated into confidence.
- One decision at the top. Everything below it is evidence for that decision.

## Accessibility & Inclusion

Read one-handed on a phone in low light shortly after waking, and on a desktop in daylight. Both themes are first-class. Nothing may depend on colour alone, since the readiness bands and the anomaly directions both carry meaning a colourblind reader has to get from text or position.
