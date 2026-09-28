import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import Encoding from "encoding-japanese";
import { importIkyuReservationFromText } from "@/steaklamp/lib/inbound/ikyu-import";

export const runtime = "nodejs";

const IKYU_INBOUND_ADDRESS =
  process.env.IKYU_INBOUND_ADDRESS ?? "ikyu-steak@phecoreer.resend.app";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

// ISO-2022-JP のまま届いた本文を Unicode に戻す
function decodeJisBody(raw: string) {
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
    console.error("STEAKLAMP_IKYU_DECODE_FAILED =", e);
    return raw;
  }
}

function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return json({ ok: false, error: "RESEND_API_KEY is not configured" }, 500);
    }

    const resend = new Resend(apiKey);
    const event = await req.json().catch(() => ({} as any));

    console.log("STEAKLAMP_IKYU_INBOUND_EVENT =", JSON.stringify(event));

    if (event?.type !== "email.received") {
      return json({ ok: true, ignored: true, reason: "not_email_received" });
    }

    const emailId =
      event?.data?.email_id ??
      event?.data?.id ??
      event?.email_id ??
      event?.id;

    if (!emailId) {
      return json({ ok: false, error: "email_id not found in webhook payload" }, 400);
    }

    const { data: receivedEmail, error: receivedError } =
      await resend.emails.receiving.get(String(emailId));

    if (receivedError) {
      console.error("STEAKLAMP_IKYU_RECEIVED_GET_ERROR =", receivedError);
      return json({ ok: false, error: receivedError.message }, 500);
    }

    const toText = JSON.stringify((receivedEmail as any)?.to ?? "").toLowerCase();

    if (!toText.includes(IKYU_INBOUND_ADDRESS.toLowerCase())) {
      console.log("STEAKLAMP_IKYU_IGNORE_TO =", toText);
      return json({
        ok: true,
        ignored: true,
        reason: "not_ikyu_mail",
        to: (receivedEmail as any)?.to ?? null,
      });
    }

    const rawBody = receivedEmail?.text
      ? String(receivedEmail.text)
      : htmlToText(String(receivedEmail?.html ?? ""));

    const textBody = decodeJisBody(rawBody.trim()).trim();
    const subject = decodeJisBody(String((receivedEmail as any)?.subject ?? "")).trim();

    console.log("STEAKLAMP_IKYU_SUBJECT =", subject);
    console.log("STEAKLAMP_IKYU_TEXT_BODY_HEAD =", textBody.slice(0, 1000));

    if (!textBody) {
      console.warn("STEAKLAMP_IKYU_EMPTY_BODY =", emailId);
      return json({ ok: true, ignored: true, reason: "empty_email_body" });
    }

    const result = await importIkyuReservationFromText({
      rawText: textBody,
      subject,
      messageId:
        (receivedEmail as any)?.headers?.["message-id"] ??
        (receivedEmail as any)?.messageId ??
        null,
    });

    console.log("STEAKLAMP_IKYU_IMPORT_RESULT =", JSON.stringify(result, null, 2));

    return json({ ok: true, emailId, result });
  } catch (e: any) {
    console.error("STEAKLAMP_IKYU_FATAL =", e);
    return json({ ok: false, error: e?.message ?? String(e) }, 500);
  }
}
