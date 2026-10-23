import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

import { ProviderUnavailableError } from '../http/resilient-http';
import { type EmailMessage, type EmailSender } from './email-sender.port';
import { buildMime } from './mime';

/** Amazon SES v2. The SDK retries throttling and 5xx itself (standard retry mode). */
export class SesEmailSender implements EmailSender {
  private readonly client: SESv2Client;

  constructor(private readonly config: { region: string; endpoint?: string; from?: string }) {
    this.client = new SESv2Client({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      maxAttempts: 3,
    });
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const from = message.from ?? this.config.from;
    if (!from) throw new ProviderUnavailableError('ses', 'SES_FROM_ADDRESS not configured');
    if (message.attachments?.length || message.cc?.length) {
      // Attachments and copies go as a raw MIME message (D-430: e-Tax by Email).
      try {
        const result = await this.client.send(
          new SendEmailCommand({
            FromEmailAddress: from,
            Destination: {
              ToAddresses: [message.to],
              ...(message.cc?.length && { CcAddresses: message.cc }),
            },
            Content: { Raw: { Data: buildMime(message, from) } },
          }),
        );
        return { providerMessageId: result.MessageId ?? 'unknown' };
      } catch (error) {
        throw new ProviderUnavailableError('ses', error instanceof Error ? error.name : 'send failed');
      }
    }
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: message.html, Charset: 'UTF-8' },
                ...(message.text && { Text: { Data: message.text, Charset: 'UTF-8' } }),
              },
            },
          },
        }),
      );
      return { providerMessageId: result.MessageId ?? 'unknown' };
    } catch (error) {
      throw new ProviderUnavailableError('ses', error instanceof Error ? error.name : 'send failed');
    }
  }
}
