import Handlebars from 'handlebars';
import mjml2html from 'mjml';

export interface RenderedMessage {
  subject: string | null;
  /** HTML for e-mail, plain text for every other channel. */
  body: string;
  /** Plain-text alternative for e-mail. */
  text: string;
}

const MAX_TEXT = 5_000;

/**
 * Notification templates are Handlebars; e-mail bodies may be MJML (`<mjml>…`), compiled to
 * responsive HTML. Values are HTML-escaped in e-mail and left as-is in text channels. Templates see
 * `{{event.type}}`, `{{event.occurredAt}}`, `{{payload.*}}`, `{{recipient.displayName}}` and `{{link}}` — the
 * recipient's deep link to the event's page (D-299), absent when the event has no page in their zone.
 */
export async function renderTemplate(
  channel: string,
  template: { subject: string | null; body: string },
  context: Record<string, unknown>,
): Promise<RenderedMessage> {
  const isEmail = channel === 'email';
  const compile = (source: string) =>
    Handlebars.compile(source, { noEscape: !isEmail, strict: false })(context);
  const subject = template.subject ? Handlebars.compile(template.subject, { noEscape: true })(context) : null;
  const expanded = compile(template.body);
  if (!isEmail) return { subject, body: expanded.slice(0, MAX_TEXT), text: expanded.slice(0, MAX_TEXT) };
  const html = expanded.trimStart().startsWith('<mjml')
    ? (await mjml2html(expanded, { validationLevel: 'soft' })).html
    : expanded;
  return {
    subject,
    body: html,
    text: html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TEXT),
  };
}

/** Throws with the Handlebars parse error when a template does not compile. */
export function assertTemplateCompiles(source: string): void {
  Handlebars.precompile(source);
}
