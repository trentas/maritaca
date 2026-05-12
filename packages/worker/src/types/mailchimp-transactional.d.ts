declare module '@mailchimp/mailchimp_transactional' {
  interface MandrillRecipient {
    email: string
    name?: string
    type: 'to' | 'cc' | 'bcc'
  }

  interface MandrillMessage {
    from_email: string
    from_name?: string
    to: MandrillRecipient[]
    subject: string
    text?: string
    html?: string
    headers?: Record<string, string>
  }

  interface MandrillSendResult {
    email: string
    status: 'sent' | 'queued' | 'scheduled' | 'rejected' | 'invalid'
    _id?: string
    reject_reason?: string | null
  }

  interface MandrillErrorResponse {
    status: string
    name?: string
    message?: string
  }

  interface MandrillClient {
    messages: {
      send(params: { message: MandrillMessage }): Promise<MandrillSendResult[] | MandrillErrorResponse>
    }
    users: {
      ping(): Promise<string | MandrillErrorResponse>
    }
  }

  export default function mailchimpFactory(apiKey: string): MandrillClient
}
