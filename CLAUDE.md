# Leadex

## Testing

- Unit and component tests (Vitest, jsdom): `npm test --workspace frontend`. Files sit next to the code as `*.test.ts(x)`.
- Browser journeys (Playwright, Chromium) against the fake backend in `frontend/e2e/fake-backend.ts`: `npm run e2e --workspace frontend`. It builds the static site first.
- Backend (Vitest): `DYNAMODB_ENDPOINT=http://localhost:8000 CLICKHOUSE_URL=http://localhost:8123 npm test --workspace backend` with DynamoDB Local and ClickHouse running in Docker (see README).
- Every test starts with a `protects=` / `fails_when=` / `no_claim=` comment.
