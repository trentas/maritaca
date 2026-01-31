# Configuring Resend for Email with Maritaca

This guide explains how to configure **Resend** for sending email from **Maritaca**, both on the Resend side (API key, domain verification, webhooks) and on the Maritaca side (environment variables and API usage).

---

## Overview

Maritaca can send email via **Resend**, **AWS SES**, or a **mock** provider (for development). When using Resend:

- The **worker** uses the Resend API to send emails (requires `RESEND_API_KEY`).
- The **API** can receive Resend webhooks to update delivery status (`delivered`, `bounced`, etc.) and optionally fetch status on demand (requires `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`).
- You must set **EMAIL_PROVIDER=resend** and provide a **sender email** (from a verified domain) in each message.

---

## Part 1: Resend configuration

### 1.1. Create an account and API key

1. Sign up at [resend.com](https://resend.com) and log in to the dashboard.
2. Go to **API Keys** (or **Dashboard** → **API Keys**).
3. Click **Create API Key**.
4. Give the key a name (e.g. `maritaca-production`) and choose **Sending access** (or **Full access** if you need to manage domains/webhooks via API).
5. Optionally restrict the key to a specific **domain** (under Sending access).
6. Click **Add** and **copy the API key** immediately (it is shown only once).  
   This becomes `RESEND_API_KEY` in Maritaca.

See [Resend: API Keys](https://resend.com/docs/dashboard/api-keys/introduction) and [Create API Key](https://resend.com/docs/api-reference/api-keys/create-api-key).

### 1.2. Verify a domain

To send from your own domain (e.g. `noreply@yourdomain.com`), you must add and verify the domain in Resend.

1. In the Resend dashboard, go to **Domains**.
2. Click **Add Domain** and enter your domain (e.g. `yourdomain.com`).
3. Resend will show **DNS records** (SPF, DKIM, and optionally DMARC). Add these records to your DNS provider (TXT and/or CNAME as indicated).
4. After DNS propagation, click **Verify** (or **Verify DNS Records**) in Resend. The domain status should become **Verified**.

Until the domain is verified, Resend may only allow sending to registered email addresses (e.g. your account email) or from a Resend onboarding domain, depending on your account. Use a verified domain for production.

See [Resend: Domains](https://resend.com/docs/dashboard/domains/introduction).

### 1.3. Create a webhook (optional but recommended)

Webhooks let Resend notify Maritaca when an email is delivered, bounced, etc., so message status stays up to date.

1. In the Resend dashboard, go to **Webhooks**.
2. Click **Add Webhook** (or **Create Webhook**).
3. Set **Endpoint URL** to your Maritaca API base URL plus the path:
   ```text
   https://your-api-host.example.com/webhooks/resend
   ```
   (Use HTTPS and the same host that serves your Maritaca API.)
4. Select the **events** you care about (e.g. `email.delivered`, `email.bounced`, `email.complained`). Maritaca maps these to `provider_last_event` on the attempt (e.g. `delivered`, `bounced`).
5. Create the webhook and **copy the Signing Secret** (sometimes labeled as webhook secret or Svix signing secret).  
   This becomes `RESEND_WEBHOOK_SECRET` in Maritaca.

Maritaca verifies webhook requests using the **Svix** signature headers (`svix-id`, `svix-timestamp`, `svix-signature`). If `RESEND_WEBHOOK_SECRET` is not set, the API will respond with 503 for webhook requests.

See [Resend: Webhooks](https://resend.com/docs/api-reference/webhooks/create-webhook).

---

## Part 2: Maritaca configuration

### 2.1. Environment variables

**Worker** (sends email via Resend):

| Variable           | Required | Description |
|--------------------|----------|-------------|
| `EMAIL_PROVIDER`   | No       | `resend` (use Resend), `ses` (AWS SES), or `mock` (no real send). Default: `mock`. Set to `resend` to send via Resend. |
| `RESEND_API_KEY`   | Yes*     | Resend API key (e.g. `re_xxxxx`). Required when `EMAIL_PROVIDER=resend`. |

\* If `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` is missing, the worker will fail when creating the email provider.

**API** (webhooks and optional on-demand status):

| Variable                 | Required | Description |
|--------------------------|----------|-------------|
| `RESEND_WEBHOOK_SECRET`  | No       | Webhook signing secret from Resend. If unset, `POST /webhooks/resend` returns 503. |
| `RESEND_API_KEY`         | No       | Used by the API to fetch the latest status for an email (e.g. when returning message details and the attempt has no `provider_last_event` yet). |

**Example `.env` (worker and API):**

```bash
# Email via Resend
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional: so Maritaca can accept Resend webhooks and update delivery status
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **Security Warning:** Never commit API keys or secrets to version control. Use environment variables, secret managers (e.g., AWS Secrets Manager, Vault), or `.env` files that are excluded from git (via `.gitignore`).

### 2.2. Sending email via the API

Send a notification with email by including the `email` channel, a **sender** with an **email** (from a verified Resend domain), and a **recipient** with an **email**.

**Example request:**

```bash
curl -X POST http://localhost:7377/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": { "name": "My App", "email": "noreply@yourdomain.com" },
    "recipient": { "email": "user@example.com" },
    "channels": ["email"],
    "payload": {
      "title": "Welcome",
      "text": "Thanks for signing up."
    }
  }'
```

> **Note:** The example uses `localhost:7377`; adjust the host and port to match your deployment (e.g., `https://api.yourdomain.com` in production).

**Requirements:**

- **`sender.email`** – Required for Resend. Use an address on a domain you verified in Resend (e.g. `noreply@yourdomain.com`).
- **`recipient.email`** – One or more recipient email addresses.
- **`channels`** – Include `"email"` so the worker uses the email provider (Resend when `EMAIL_PROVIDER=resend`).
- **`payload.text` or `payload.html`** – At least one is required. The email body can be plain text, HTML, or both. If both are provided, email clients will display HTML when supported and fall back to text.

**Email-specific overrides** (optional) – see [Maritaca API spec](./MARITACA_API_SPEC.md) for full payload shape. The Resend provider uses `payload.title` (as subject) and `payload.text`/`payload.html` for the email body.

### 2.3. Webhook endpoint

Maritaca exposes a single Resend webhook route:

- **URL:** `POST /webhooks/resend`
- **Auth:** No Bearer token; requests are verified using the **Svix signature** and `RESEND_WEBHOOK_SECRET`.
- **Rate limiting / auth:** This path is typically excluded from rate limiting and API key auth so Resend can call it.

Configure this URL in the Resend dashboard as the webhook endpoint (see 1.3). The API will update the corresponding attempt’s `provider_last_event` (e.g. `delivered`, `bounced`) when Resend sends events.

### 2.4. Using AWS SES or mock instead of Resend

- **AWS SES:** Set `EMAIL_PROVIDER=ses` and configure AWS credentials (e.g. `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). The API payload (sender, recipient, channels, payload) stays the same.
- **Mock (no real send):** Set `EMAIL_PROVIDER=mock` or leave it unset (default). Useful for local development.

---

## Summary

| Side      | What to do |
|-----------|------------|
| **Resend**| Create an API key (Sending access). Add and verify your domain (DNS). Optionally create a webhook to `https://your-api/webhooks/resend` and copy the signing secret. |
| **Maritaca** | Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` in the worker. Set `RESEND_WEBHOOK_SECRET` in the API if you use webhooks. Send email via the API with `channels: ["email"]`, `sender.email` (verified domain), and `recipient.email`. |

---

## Troubleshooting

### "Sender email is required for Resend provider"

Ensure your request includes `sender.email` with an address from a verified Resend domain.

### "Email must have at least text or html content"

The `payload` must include either `text`, `html`, or both. Empty email bodies are not allowed.

### Webhook returns 503 "Webhook not configured"

Set the `RESEND_WEBHOOK_SECRET` environment variable in the API. Get the signing secret from the Resend Dashboard under Webhooks.

### Webhook returns 400 "Invalid signature"

- Verify that `RESEND_WEBHOOK_SECRET` matches the signing secret from your Resend webhook.
- Ensure the webhook URL in Resend points exactly to your API endpoint (e.g., `https://api.example.com/webhooks/resend`).
- Check that no proxy or load balancer is modifying the request body (the signature is sensitive to any change).

### Email not delivered / status not updating

- Check that webhooks are configured in Resend and pointing to the correct URL.
- Verify the API has network access to receive incoming webhook requests.
- If webhooks are not configured, Maritaca will attempt to fetch status on-demand when you retrieve the message via `GET /v1/messages/:id`.

---

## References

- [Resend – API Keys](https://resend.com/docs/dashboard/api-keys/introduction)
- [Resend – Domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend – Webhooks](https://resend.com/docs/api-reference/webhooks/create-webhook)
- [Maritaca API spec](./MARITACA_API_SPEC.md) – message format and channels
