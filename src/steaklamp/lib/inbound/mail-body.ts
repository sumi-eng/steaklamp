import Encoding from "encoding-japanese";

// ISO-2022-JP(JIS)のエスケープシーケンスのまま届いた文字列をUnicodeに戻す。
// すでに読める文字列(UTF-8の新規メール等)はそのまま返す。
export function decodeJisIfNeeded(raw: string) {
  if (!raw) return raw;

  const looksGarbled =
    raw.includes("\\u001b") ||
    raw.includes("\u001b") ||
    raw.includes("$B") ||
    raw.includes("(B");

  if (!looksGarbled) return raw;

  try {
    const escaped = raw
      .replace(/\\u001b/g, "\u001b")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"');

    const codes = Encoding.stringToCode(escaped);
    const unicodeArray = Encoding.convert(codes, {
      from: "JIS",
      to: "UNICODE",
    });

    return Encoding.codeToString(unicodeArray);
  } catch (e) {
    console.error("STEAKLAMP_MAIL_DECODE_FAILED =", e);
    return raw;
  }
}

export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Resendの受信メールから、デコード済みの本文と件名を取り出す共通処理
export function extractMailContent(receivedEmail: any) {
  const rawBody = receivedEmail?.text
    ? String(receivedEmail.text)
    : htmlToText(String(receivedEmail?.html ?? ""));

  return {
    body: decodeJisIfNeeded(rawBody.trim()).trim(),
    subject: decodeJisIfNeeded(String(receivedEmail?.subject ?? "")).trim(),
  };
}
