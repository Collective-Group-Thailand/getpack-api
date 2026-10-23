/** E-mail provider port (SES). E-mail is the channel for everything (D-143). */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** D-430: e-Tax by Email copies the ETDA time-stamping address. */
  cc?: string[];
  /** D-430: the sender registered with the Revenue Department (else the default sender). */
  from?: string;
  attachments?: EmailAttachment[];
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}
