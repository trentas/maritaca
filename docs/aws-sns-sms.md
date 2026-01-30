# Configuring AWS SNS for SMS with Maritaca

This guide explains how to configure **AWS SNS** for sending SMS from **Maritaca**, both on the AWS side (IAM, permissions, access keys) and on the Maritaca side (environment variables and API usage).

---

## Overview

Maritaca can send SMS via **AWS SNS** or **Twilio**. When using SNS:

- The **worker** uses the AWS SDK to call `sns:Publish` (and optionally `sns:GetSMSAttributes` for health checks).
- You need an **IAM user** (or role) with minimal SNS permissions and **access keys** (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
- You must set **AWS_REGION** (and optionally `SMS_PROVIDER=sns`).

---

## Part 1: AWS configuration

### 1.1. IAM policy (minimal permissions)

Create an IAM policy that allows only what Maritaca needs for SNS SMS.

**Option A – Publish + health check (recommended)**

This allows sending SMS and running the provider health check (`GetSMSAttributes`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SnsSmsPublish",
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SnsGetSmsAttributes",
      "Effect": "Allow",
      "Action": [
        "sns:GetSMSAttributes",
        "sns:SetSMSAttributes"
      ],
      "Resource": "*"
    }
  ]
}
```

**Option B – Publish only (minimum)**

If you do not need the SNS health check to succeed, you can use only:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "*"
    }
  ]
}
```

**Optional – Restrict by region**

To limit the key to a single region (e.g. `us-east-1`), add a condition:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish",
        "sns:GetSMSAttributes"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-east-1"
        }
      }
    }
  ]
}
```

Use the same region in Maritaca’s `AWS_REGION` (see below).

### 1.2. Create the IAM user and attach the policy

1. In the **AWS Console**, go to **IAM** → **Users** → **Create user**.
2. Set a name (e.g. `maritaca-sns-sms`) and choose **Next**.
3. Under **Permissions**:
   - Choose **Attach policies directly**.
   - Click **Create policy** (opens in a new tab), switch to the **JSON** tab, paste one of the policy documents above, then **Next**.
   - Name the policy (e.g. `MaritacaSnsSmsOnly`) and **Create policy**.
4. Return to the user creation tab, refresh the policy list, select `MaritacaSnsSmsOnly`, then **Next** → **Create user**.

### 1.3. Create access keys

1. Open the user you created (e.g. `maritaca-sns-sms`).
2. Go to the **Security credentials** tab.
3. Under **Access keys**, click **Create access key**.
4. Choose **Application running outside AWS** (or another use case that allows creating access keys) → **Next** → **Create access key**.
5. Copy the **Access key ID** and **Secret access key** immediately (the secret is shown only once).  
   These become `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in Maritaca.

### 1.4. AWS account and SNS SMS settings

- Ensure **SNS SMS** is enabled for your account and that you have completed any required **account and destination country** settings in the SNS console (e.g. **Text messaging (SMS)** → **Sandbox** or **Production**).
- For production, configure **Spending limits** and **Default message type** (Transactional / Promotional) in **SNS** → **Text messaging (SMS)** → **Settings**.
- If you use the **SMS sandbox**, add and verify destination phone numbers in the sandbox before testing.

See [AWS SNS SMS documentation](https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html) for details.

---

## Part 2: Maritaca configuration

### 2.1. Environment variables (worker)

Set these in the **worker** environment (e.g. `.env` or your deployment config):

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | Yes (for SNS) | AWS region for SNS (e.g. `us-east-1`). |
| `AWS_ACCESS_KEY_ID` | No* | IAM access key ID. Omit when using IAM roles (e.g. EC2/ECS). |
| `AWS_SECRET_ACCESS_KEY` | No* | IAM secret access key. Omit when using IAM roles. |
| `SMS_PROVIDER` | No | `sns` (default) or `twilio`. Set to `sns` to use SNS explicitly. |

\* Required when the worker is not running with an IAM role that grants the SNS permissions above.

**Example `.env` (worker):**

```bash
# SMS via AWS SNS
SMS_PROVIDER=sns
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

If you omit `SMS_PROVIDER`, Maritaca defaults to `sns` for SMS. If `AWS_REGION` is not set, the worker still starts, but sending SMS via SNS will fail with a clear error until you set it.

### 2.2. Sending SMS via the API

Send a notification with SMS by including the `sms` channel and a recipient phone number (E.164).

**Example request:**

```bash
curl -X POST http://localhost:7377/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": { "name": "My App" },
    "recipient": { "sms": { "phoneNumber": "+5511999999999" } },
    "channels": ["sms"],
    "payload": {
      "title": "Alert",
      "text": "Your code is 123456."
    }
  }'
```

**SMS-specific overrides** (optional) in the message payload:

- `overrides.sms.messageType`: `Transactional` (default for time-sensitive) or `Promotional`.
- `overrides.sms.senderId`: Sender ID string (subject to AWS/operator limits; see [SNS SMS attributes](https://docs.aws.amazon.com/sns/latest/dg/sms_attributes.html)).

Example with overrides:

```json
{
  "sender": { "name": "My App" },
  "recipient": { "sms": { "phoneNumber": "+5511999999999" } },
  "channels": ["sms"],
  "payload": { "title": "Hi", "text": "Hello world" },
  "overrides": {
    "sms": {
      "messageType": "Transactional",
      "senderId": "MyBrand"
    }
  }
}
```

Phone numbers must be in **E.164** format (e.g. `+5511999999999`).

### 2.3. Using Twilio instead of SNS

If you use **Twilio** for SMS instead of SNS, set:

```bash
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
```

and configure the Twilio provider as per your project docs. The API payload (recipient, channels, payload) stays the same; only the provider and env vars change.

---

## Summary

| Side | What to do |
|------|------------|
| **AWS** | Create an IAM policy with `sns:Publish` (and optionally `sns:GetSMSAttributes`). Attach it to an IAM user and create access keys. |
| **Maritaca** | Set `AWS_REGION` and, if not using an IAM role, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Optionally set `SMS_PROVIDER=sns`. Send SMS via the API with `channels: ["sms"]` and `recipient.sms.phoneNumber` in E.164. |

---

## References

- [AWS SNS – Publishing to a phone number (SMS)](https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html)
- [AWS SNS SMS attributes](https://docs.aws.amazon.com/sns/latest/dg/sms_attributes.html)
- [Maritaca API spec](./MARITACA_API_SPEC.md) – message format and channels
