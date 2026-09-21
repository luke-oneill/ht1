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

Useful commands:

```sh
npm run check       # type checking, unit tests and PostgreSQL integration tests
npm run build       # compile TypeScript
npm run db:down     # stop the local database
```

`npm run check` expects the database started by `npm run db` to be available.

## What the service does

1. `POST /ingest` accepts any JSON object and stores every delivery as a raw form.
2. A sequential worker validates the next raw form. The first valid delivery for
   an `application_reference` becomes the ingested form; later deliveries are
   retained and marked as duplicates.
3. The worker looks up the postcode, transforms the ingested form into FORM-BOT's
   shape, and stores the transformed form.
4. It emails `happyforms@bots.com` and marks the work complete only after the
   provider reports success.

Invalid forms remain inspectable. Postcode and email provider failures are
retried automatically after five seconds. Validation or transformation failures 
wait for an explicit retry after the code is fixed.

## Key decisions

- **Store before interpreting.** The HTTP endpoint acknowledges only that the
  JSON has been parsed and writen to DB. An unexpected provider schema is not lost.
- **First valid reference wins.** `application_reference` is the logical identity
  and a database constraint prevents more than one ingested or transformed form.
- **Simple, layered pipeline.** Three tables (`raw_forms`, `ingested_forms`, and
  `transformed_forms`) make the processing stages visible without a generic
  workflow layer. Raw payloads are never changed, data flows downstream.
- **Keep logic testable.** Validation and transformation are pure functions;
  PostgreSQL and provider calls stay at the edges.
- **Assume one worker.** This take-home runs one sequential in-process worker.
  Production would need durable job claiming for multiple workers, stronger
  observability, authenticated inspection/replay endpoints, and real provider
  idempotency where available.
