# Local setup

[Back to README](../README.md)

## Prerequisites

- Node.js 22 or newer and npm.
- A running MongoDB instance (MongoDB 7+), or a MongoDB connection URI.

The commands below use a macOS/Linux shell. Run them from the repository root unless a step says otherwise. Install API and frontend dependencies separately.

## 1. Configure the API

```sh
npm ci
cp .env.example .env
```

Edit the root `.env` file:

| Variable | Local value or purpose |
| --- | --- |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/expense_tracker`, or your connection URI |
| `ACCESS_TOKEN_SECRET` | A randomly generated signing secret |
| `REFRESH_TOKEN_SECRET` | A different randomly generated signing secret |
| `CLIENT_URL` | `http://localhost:3001` |
| `PORT` | `3000` |
| `NODE_ENV` | `development` |

Generate each signing secret separately and replace the example values:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start your local MongoDB service if you are using the local URI, then start the API:

```sh
npm start
```

The server validates that the MongoDB URI and both signing secrets are present, then connects to MongoDB before listening. Open `http://localhost:3000/api/health` to check the HTTP response.

## 2. Start the frontend

In a second terminal:

```sh
cd auth-ui/client
npm ci
cp .env.example .env
npm start
```

The frontend example configures `REACT_APP_API_URL=http://localhost:3000` and `PORT=3001`. Open `http://localhost:3001`, register an account, and sign in.

The frontend reads `REACT_APP_API_URL` when it starts or builds. Restart it after changing that value. Browser environment variables are public configuration; signing secrets and database credentials belong only in the backend environment.

## Tests and build

From the repository root:

```sh
npm test
CI=true npm --prefix auth-ui/client test -- --watchAll=false --runInBand
CI=true npm --prefix auth-ui/client run build
```

Backend tests generate their own signing secrets and start a disposable MongoDB database. No application database connection is required. The first run may download a MongoDB binary and needs network access; subsequent runs can reuse the downloaded binary.

The frontend build is written to `auth-ui/client/build/`.

## Using a different API or frontend origin

- Set the frontend's `REACT_APP_API_URL` to the API's address before starting or building it.
- Set the backend's `CLIENT_URL` to the exact frontend origin. A comma-separated list is supported.
- Production refresh cookies use `Secure` and `SameSite=None`, so the production API must use HTTPS.
- Keep both `.env` files untracked. The committed `.env.example` files contain configuration examples only.
