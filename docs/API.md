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

Access tokens expire after 15 minutes; refresh tokens expire after seven days. The refresh cookie is HTTP-only. Browser requests that need to receive or send it use `credentials: 'include'`.

Send the access token with protected transaction requests:

```http
Authorization: Bearer <access_token>
```

Logout does not revoke issued tokens server-side; they remain valid until expiry.

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
