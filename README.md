# Expense Tracker — SpendSmart

A full-stack JavaScript application for recording income and expenses. The React dashboard connects to an Express API backed by MongoDB. The backend associates transactions with their authenticated owner and checks ownership before individual reads, updates, and deletes.

## Features

- Register, log in, refresh an access token, and log out.
- Create, view, edit, and delete income and expense transactions.
- API filtering by transaction type, date range, and amount; sorting by date or amount.
- Dashboard with monthly spending, a weekly spending chart, and recent transactions.
- Editable monthly budget stored locally in the browser.
- Joi transaction validation, JSON error responses, request rate limits, Helmet, and an origin allowlist.

## Architecture

```text
React + Tailwind (auth-ui/client)
    └── HTTP / JSON → Express routes
                       ├── JWT authentication + ownership checks
                       ├── Joi input validation
                       └── Mongoose → MongoDB
```

Authentication uses `passport-local-mongoose` for user credentials, 15-minute JWT access tokens, and a seven-day refresh token in an HTTP-only cookie. The frontend sends access tokens in the `Authorization: Bearer ...` header. Transaction queries are scoped to the authenticated user; the API assigns the owner rather than accepting it from the client.

## Run locally

Prerequisites: **Node.js 22+**, npm, and **MongoDB 7+** locally or a MongoDB connection URI. Install dependencies separately for the API and frontend.

At the repository root, create an untracked `.env` file:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/expense_tracker
ACCESS_TOKEN_SECRET=replace-with-a-random-secret
REFRESH_TOKEN_SECRET=replace-with-a-different-random-secret
CLIENT_URL=http://localhost:3001
PORT=3000
NODE_ENV=development
```

Generate each secret separately with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep real credentials out of Git. `CLIENT_URL` supports a comma-separated list of allowed frontend origins; production refresh cookies require HTTPS.

Start the API from the repository root:

```sh
npm ci
npm start
```

The API listens at **http://localhost:3000**. Check **http://localhost:3000/api/health** for the HTTP health endpoint.

In a second terminal, start the frontend:

```sh
cd auth-ui/client
npm ci
PORT=3001 npm start
```

Open **http://localhost:3001**, register an account, and log in. The frontend defaults to the API at `http://localhost:3000`. To use another API address, set `REACT_APP_API_URL` in `auth-ui/client/.env` before starting or building the frontend. Frontend environment variables are public browser configuration; never put secrets in them.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/register` | Register with email, username, and password |
| POST | `/login` | Return an access token and set the refresh cookie |
| POST | `/refresh` | Exchange the refresh cookie for an access token |
| POST | `/logout` | Clear the refresh cookie |
| GET | `/api/health` | HTTP health response |
| GET | `/transactions/ping` | Transaction router health response |
| GET | `/transactions` | List the authenticated user's transactions |
| POST | `/transactions` | Create a transaction for the authenticated user |
| GET | `/transactions/:id` | Read an owned transaction |
| PUT | `/transactions/:id/edit` | Update an owned transaction |
| DELETE | `/transactions/:id` | Delete an owned transaction |

Transaction data uses `statements` (description), positive `amount`, `type` (`Income` or `Expense`), and an ISO `date`. All transaction routes except `/transactions/ping` require a Bearer access token. List query parameters are `type`, `startDate`, `endDate`, `minAmount`, `maxAmount`, and `sort` (`oldest`, `amount`, or the default newest-first order).

## Tests

From the repository root:

```sh
npm test
```

The backend integration suite uses **Jest**, **Supertest**, and **mongodb-memory-server** with a disposable MongoDB instance, separate from your application database. The first run may download a MongoDB binary and needs network access. Ownership tests use separate users to check that one user's transactions do not appear in another user's list and cannot be read, changed, or deleted by that user.

Run frontend tests separately:

```sh
cd auth-ui/client
CI=true npm test -- --watchAll=false
```

## Current limitations

- This README documents local setup; a verified production demo is not currently linked.
- Logout clears the refresh cookie but does not revoke issued tokens server-side. A copied token remains valid until expiry; refresh-token rotation and revocation are not implemented.
- The monthly budget is browser-local, not synchronized to an account or across devices.
- The health endpoints confirm HTTP responsiveness, not database readiness.
