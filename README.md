# Healthtech-1 form ingestion

A small service that accepts registration-form deliveries from an unreliable
provider and prepares the first valid form for FORM-BOT.

## Run locally

You need Node.js, npm and Docker.

```sh
npm ci
npm run db
npm run dev
```

The API listens on `http://localhost:3000`. Submit a supplied example:

```sh
curl -i \
  -H 'Content-Type: application/json' \
  --data @src/supplied/examples/person_one.json \
  http://localhost:3000/ingest
```

The endpoint returns `202 Accepted` once the JSON object is stored. Use
the returned `rawFormId` to inspect its asynchronous progress or replay a failed
form:

```sh
curl http://localhost:3000/ingestions/<rawFormId>
curl -X POST http://localhost:3000/ingestions/<rawFormId>/retry
```

List the most recent conflicting deliveries without exposing their payloads:

```sh
curl 'http://localhost:3000/ingestions?status=conflict&limit=50'
```

Useful commands:

```sh
npm run check       # type checking, unit tests and PostgreSQL integration tests
npm run build       # compile TypeScript
npm start           # run the compiled service after building
npm run db:down     # stop the local database
```

`npm run check` expects the database started by `npm run db` to be available.

## What the service does

1. `POST /ingest` accepts any JSON object and stores every delivery as a raw form.
2. A sequential worker validates the next raw form. The first valid delivery for
   an `application_reference` becomes the ingested form; identical redeliveries
   are duplicates and changed deliveries are held for review as conflicts. The
   worker rotates across stages so new deliveries cannot starve forms already
   further through the pipeline.
3. The worker looks up the postcode, transforms the ingested form into FORM-BOT's
   shape, stores it, and marks it as awaiting notification.
4. It emails `happyforms@bots.com` and marks the work complete only after the
   provider reports success.

Invalid forms remain inspectable. Postcode and email provider failures are
retried automatically after five seconds. Validation or transformation failures 
wait for an explicit retry after the code is fixed.

## Key decisions

- **Store before interpreting.** The HTTP endpoint acknowledges only that the
  JSON has been parsed and written to the database. An unexpected provider schema
  is not lost.
- **Separate redelivery from conflict.** `application_reference` is the logical
  identity. Identical payloads are benign duplicates; changed payloads are held
  as conflicts so a correction is not silently discarded or applied. Resolving
  those conflicts is deliberately left to a future product decision.
- **Simple, layered pipeline.** Three tables (`raw_forms`, `ingested_forms`, and
  `transformed_forms`) make the processing stages visible without a generic
  workflow layer. Raw payloads are never changed, data flows downstream.
- **Keep logic testable.** Validation and transformation are pure functions;
  PostgreSQL and provider calls stay at the edges.
- **Assume one worker.** This take-home runs one sequential in-process worker.
  Production would need durable job claiming for multiple workers, stronger
  observability, authenticated inspection/replay endpoints, and real provider
  idempotency where available.
