# SpendSmart

A full-stack expense tracker built with React, Express, and MongoDB. Record income and expenses, review spending trends, and manage a monthly budget. Transactions belong to individual accounts, with ownership enforced by the API.

[Local setup](docs/SETUP.md) · [API reference](docs/API.md) · [Backend tests](tests/api.test.js) · [Frontend tests](auth-ui/client/src/App.test.js)

## Features

- **Transaction management:** create, view, edit, and delete income and expense records.
- **Spending dashboard:** monthly expenses, a seven-day spending chart, and recent transactions.
- **Monthly budget:** set a budget and see spending against it; the budget is stored in the browser.
- **Account access:** registration, login, JWT access tokens, and refresh tokens in HTTP-only cookies.
- **Per-user data access:** authenticated users can access only their own transactions.
- **API filtering:** filter records by type, date, and amount; sort by date or amount.

## Stack

| Area | Tools |
| --- | --- |
| Frontend | JavaScript, React, Tailwind CSS |
| Backend | Node.js, Express |
| Database | MongoDB, Mongoose |
| Authentication and validation | JWT, passport-local-mongoose, Joi |
| Testing and automation | Jest, Supertest, React Testing Library, GitHub Actions |

## How it works

```text
React dashboard → Express API → Mongoose → MongoDB
                      │
                      ├── JWT authentication
                      ├── Transaction ownership checks
                      └── Joi request validation
```

The API assigns transaction ownership from the authenticated user's token. List queries include the user's ID, and individual reads, updates, and deletes check ownership. Helmet, request rate limits, and a CORS origin allowlist provide additional request controls.

## Run locally

Requires **Node.js 22+**, npm, and a running MongoDB instance or connection URI.

Follow the [setup guide](docs/SETUP.md) to configure the two environment files and start the API at `http://localhost:3000` and the frontend at `http://localhost:3001`.

## Tests

| Suite | Cases | What it checks |
| --- | ---: | --- |
| [API integration](tests/api.test.js) | 28 | Authentication, token refresh, per-user access, transaction operations, filtering, and input validation |
| [React UI](auth-ui/client/src/App.test.js) | 4 | Navigation, registration, successful login, and rejected login using mocked API responses |

```sh
# From the repository root
npm test

# Frontend tests, also from the repository root
CI=true npm --prefix auth-ui/client test -- --watchAll=false --runInBand
```

API tests run against a disposable MongoDB instance with generated test secrets. They do not connect to the application database. The first run may download a MongoDB binary.

The ownership tests create two users and verify that one cannot list, read, update, or delete the other's transactions. They also check that blocked requests leave the stored record unchanged.

[GitHub Actions](.github/workflows/ci.yml) runs both test suites and the frontend production build on pull requests and pushes to `main`.

## Current limitations

- Monthly budgets are browser-local and are not synchronized to an account or across devices.
- Logout clears the refresh cookie; issued tokens remain valid until expiry. Refresh-token rotation and server-side revocation are not implemented.
- Health endpoints report HTTP responsiveness rather than database readiness.
