// ============================================================
// The message a customer receives when the bot hands the chat to a
// human (or the AI provider fails). Before this, a handoff was silent:
// the customer saw "typing…" and then nothing.
// ============================================================

export const DEFAULT_HOLDING_MESSAGE_DARI =
  'تشکر از پیام تان 🙏 یکی از همکاران ما به زودی جواب تان را میدهد.'

export const DEFAULT_HOLDING_MESSAGE_EN =
  'Thanks for your message 🙏 A member of our team will reply to you shortly.'

/** Longest custom holding message an admin may save. */
export const MAX_HOLDING_MESSAGE_LENGTH = 500

/** True when the text contains Arabic-script letters (Dari, Pashto…). */
export function containsArabicScript(text: string): boolean {
  return /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text)
}

/**
 * Pick the holding message: the shop's own text when it set one,
 * otherwise the default in the customer's script (Dari for Arabic
 * script, English otherwise).
 */
export function holdingMessageFor(
  custom: string | null | undefined,
  lastCustomerText: string,
): string {
  const own = (custom ?? '').trim()
  if (own) return own
  return containsArabicScript(lastCustomerText)
    ? DEFAULT_HOLDING_MESSAGE_DARI
    : DEFAULT_HOLDING_MESSAGE_EN
}
