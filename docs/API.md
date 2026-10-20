# API reference

[Back to README](../README.md)

Local base URL: `http://localhost:3000`. Send JSON bodies with `Content-Type: application/json`.

## Authentication

| Method | Path | Request or behavior |
| --- | --- | --- |
| POST | `/register` | Register with `email`, `username`, and `password` |
| POST | `/login` | Submit `username` and `password`; receive an `accessToken` and refresh cookie |
| POST | `/refresh` | Send the refresh cookie to obtain an access token |
| POST | `/logout` | Clear the refresh cookie |
| POST | `/forgot-password` | Request a reset email with `{ "email": "you@example.com" }` |
| POST | `/reset-password` | Set a new password with `token`, `password`, and matching `confirmPassword` |

Access tokens expire after 15 minutes; refresh tokens expire after seven days. The refresh cookie is HTTP-only. Browser requests that need to receive or send it use `credentials: 'include'`.

Send the access token with protected transaction requests:

```http
Authorization: Bearer <access_token>
```

Registration and password reset require 12–128 characters for new passwords. Existing accounts can continue signing in with their current password.

Logout does not revoke issued tokens server-side; they remain valid until expiry. A successful password reset invalidates the account's previously issued access and refresh tokens.

### Password recovery

`POST /forgot-password` returns the same `202` response for matching and unknown accounts: `If an account matches that email, a reset link will be sent.` It never returns a token or reveals whether an email address is registered. If sending is not configured, it returns `503` for every address. Requests are rate limited.

Reset links expire after 15 minutes and can be used once. Only a hash of the reset token is stored. The link opens the configured frontend with a token in its URL fragment; the frontend removes the fragment after reading it and submits the token in the reset request body.

`POST /reset-password` returns `200` after updating the password. Invalid, expired, and already-used links return `400`. Users sign in normally after resetting; a reset does not create a logged-in session.

## Transactions

All endpoints below require an access token. The API uses the authenticated user as the owner; a client-supplied `owner` field is rejected.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/transactions` | List the authenticated user's transactions |
| POST | `/transactions` | Create a transaction |
| GET | `/transactions/:id` | Read an owned transaction |
| PUT | `/transactions/:id/edit` | Replace the editable fields of an owned transaction |
| DELETE | `/transactions/:id` | Delete an owned transaction |

Creation and update accept the same flat JSON body; all four fields are required:

```json
{
  "statements": "Groceries",
  "amount": 25.5,
  "type": "Expense",
  "date": "2026-10-20"
}
```

`statements` is the transaction description. `amount` must be positive, `type` must be `Income` or `Expense`, and `date` must be an ISO date. The API stores a description, amount, type, date, and owner for each transaction.

### List filters

| Query parameter | Purpose |
| --- | --- |
| `type` | Filter by `Income` or `Expense` |
| `startDate`, `endDate` | Set inclusive date bounds |
| `minAmount`, `maxAmount` | Set inclusive amount bounds |
| `sort` | `oldest` for ascending date, `amount` for descending amount; otherwise newest first |

Example: `/transactions?type=Expense&minAmount=20&sort=amount`.

Filtering and sorting are API capabilities; the dashboard does not currently expose these controls.

### Transaction response codes

- `201`: transaction created.
- `200`: list, read, update, or delete succeeded.
- `400`: invalid transaction body or malformed transaction ID.
- `401`: missing, invalid, or expired access token.
- `403`: authenticated user does not own the requested transaction.
- `404`: a valid transaction ID has no matching record.
- `429`: transaction request rate limit reached.

## Public health endpoints

`GET /api/health` and `GET /transactions/ping` return `{ "ok": true }` without authentication. These endpoints confirm HTTP responsiveness, not database readiness.
