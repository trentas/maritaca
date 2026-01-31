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

SMS is available in SNS by default in [regions that support SMS](https://docs.aws.amazon.com/general/latest/gr/end-user-messaging.html). There is no separate “activate SMS” switch; you configure preferences and, if your account is in the SMS sandbox, request production access to send to any number (see [1.5](#15-leaving-the-sms-sandbox-sending-to-any-number)).

**Where to configure SMS in the console**

1. Sign in to the [Amazon SNS console](https://console.aws.amazon.com/sns/home).
2. Select a **region** that supports SMS (e.g. `us-east-1`).
3. In the left navigation, go to **Mobile** → **Text messaging (SMS)** (or **Text messaging (SMS)** directly, depending on the console layout).
4. On the **Mobile text messaging (SMS)** page, find the **Text messaging preferences** section and choose **Edit**.
5. On **Edit text messaging preferences**, set:
   - **Default message type**: `Transactional` (higher reliability) or `Promotional` (lower cost).
   - **Account spend limit** (optional): monthly SMS spend limit in USD (default is often 1.00 USD; you can [request a quota increase](https://console.aws.amazon.com/support/home#/case/create?issueType=service-limit-increase&limitType=service-code-sns) if needed).
   - **Default sender ID** (optional): brand or identifier shown as sender (support varies by country).
6. Choose **Save changes**.

If your account is in the **SMS sandbox**, you can only send to verified destination phone numbers. Add and verify them in the **Sandbox destination phone numbers** section on the same **Text messaging (SMS)** page before testing. To send to any number, you must leave the sandbox (see next section).

See [AWS SNS SMS documentation](https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html) and [Setting SMS messaging preferences](https://docs.aws.amazon.com/sns/latest/dg/sms_preferences.html) for details.

### 1.5. Leaving the SMS sandbox (sending to any number)

New AWS SNS SMS accounts start in the **SMS sandbox**. In the sandbox you can only send SMS to **verified destination phone numbers** (up to 10). To send to **any phone number**, you must request **production access** so your account can leave the sandbox.

**Option A – From the SNS console**

1. In the [Amazon SNS console](https://console.aws.amazon.com/sns/home), select a region that supports SMS.
2. Go to **Text messaging (SMS)** (under **Mobile** or in the left navigation).
3. On the **Text messaging (SMS)** page, look for a section related to **Sandbox** (e.g. “SMS sandbox”, “Sandbox destination phone numbers”, or “Account status”).
4. Use the **Request production access** (or similar) link or button, if available in your region/console version.
5. Fill in the form (use case, expected volume, destination countries) and submit. AWS will review and, if approved, your account will be able to send SMS to any recipient (subject to country-specific rules).

**Option B – Via AWS Support (service limit increase)**

If you do not see a “Request production access” option in the console:

1. Open [AWS Support Center](https://console.aws.amazon.com/support/home) → **Create case**.
2. Choose **Service limit increase**.
3. For **Limit type**, select **SNS** (or **SNS Text Messaging** / **SMS**, if listed).
4. In the request, state that you need **SMS production access** (leave the SMS sandbox) to send SMS to any phone number.
5. Provide use case (e.g. transactional notifications, 2FA, alerts), expected volume, and destination countries.
6. Submit the case and wait for AWS to respond (often a few business days).

**Country-specific requirements**

Some countries require additional steps before or after production access:

- **Company registration**: You may need to register your company with AWS End User Messaging (e.g. for certain sender IDs or origination numbers). See [Supported countries and regions for SMS](https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-sms-by-country.html) in the *AWS End User Messaging SMS User Guide*.
- **Origination identity**: For some regions (e.g. US), you may need a dedicated origination number (10DLC, toll-free, etc.) or sender ID. See [Origination identities for Amazon SNS SMS messages](https://docs.aws.amazon.com/sns/latest/dg/channels-sms-originating-identities.html).

For more on the sandbox and first steps, see [Using the Amazon SNS SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html).

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
| **AWS** | Create an IAM policy with `sns:Publish` (and optionally `sns:GetSMSAttributes`). Attach it to an IAM user and create access keys. Configure SMS preferences in **SNS** → **Text messaging (SMS)** → **Text messaging preferences** → **Edit**. To send to any number, request production access to leave the SMS sandbox (console or AWS Support). |
| **Maritaca** | Set `AWS_REGION` and, if not using an IAM role, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Optionally set `SMS_PROVIDER=sns`. Send SMS via the API with `channels: ["sms"]` and `recipient.sms.phoneNumber` in E.164. |

---

## References

- [AWS SNS – Publishing to a phone number (SMS)](https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html)
- [AWS SNS SMS attributes](https://docs.aws.amazon.com/sns/latest/dg/sms_attributes.html)
- [Setting SMS messaging preferences in Amazon SNS](https://docs.aws.amazon.com/sns/latest/dg/sms_preferences.html)
- [Using the Amazon SNS SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html)
- [Adding and verifying phone numbers in the SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox-verifying-phone-numbers.html)
- [Origination identities for Amazon SNS SMS messages](https://docs.aws.amazon.com/sns/latest/dg/channels-sms-originating-identities.html)
- [Supported countries and regions for SMS (AWS End User Messaging)](https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-sms-by-country.html)
- [Maritaca API spec](./MARITACA_API_SPEC.md) – message format and channels
