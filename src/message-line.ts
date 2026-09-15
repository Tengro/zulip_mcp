/**
 * The one line a Zulip message takes wherever the model reads it: live
 * delivery (`channels/incoming`, `push/event`, recovered replays), the
 * `<missed>` catch-up block, the recent history injected before inference,
 * and `fetch_history` / `fetch_around`:
 *
 *   [<time> id=N] [#stream > topic] Author (mention): text
 *   [<time> id=N] [DM] Author: text
 *
 * `<time>` is the agent-visible time (see `agentLineTimeFormatter`); an
 * empty time leaves `[id=N]`. `(mention)` marks a stream message that
 * mentions the bot; a direct message is addressed by definition and says
 * `[DM]` instead. Surfaces append their own trailers after the text
 * (attachments, reactions, the fetch_around anchor mark).
 *
 * Header fields are folded onto one line (control characters, newlines
 * included, become a single space) so no field can start a new line. They
 * are not escaped: a name or topic containing `]: ` still reads ambiguously
 * to a regex. Zulip already refuses control characters and some punctuation
 * in display names; topics are the realistic source.
 */

export interface MessageLineHead {
  id: number | string;
  /** Rendered time; '' omits it. */
  time: string;
  /** Stream name, or null for a direct message. */
  stream: string | null;
  topic: string;
  author: string;
  /** The bot is mentioned. Rendered on stream messages only. */
  mentioned: boolean;
}

/** C0 controls, DEL, and the Unicode line and paragraph separators. */
function isLineBreaking(codePoint: number): boolean {
  return codePoint < 0x20 || codePoint === 0x7f || codePoint === 0x2028 || codePoint === 0x2029;
}

/** One header field on one line: each run of line-breaking characters becomes one space. */
export function headerField(value: string): string {
  let out = '';
  let inRun = false;
  for (const ch of value) {
    if (isLineBreaking(ch.codePointAt(0) ?? 0)) {
      if (!inRun) out += ' ';
      inRun = true;
    } else {
      out += ch;
      inRun = false;
    }
  }
  return out;
}

/** `[<time> id=N] [#stream > topic] Author (mention): ` -- the text follows. */
export function messageLineHead(h: MessageLineHead): string {
  const where = h.stream === null ? '[DM]' : `[#${headerField(h.stream)} > ${headerField(h.topic)}]`;
  const mark = h.stream !== null && h.mentioned ? ' (mention)' : '';
  const time = headerField(h.time);
  return `[${time ? `${time} ` : ''}id=${h.id}] ${where} ${headerField(h.author)}${mark}: `;
}
