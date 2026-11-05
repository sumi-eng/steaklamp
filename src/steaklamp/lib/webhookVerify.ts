// 受信口（Resend の受信webhook・LINE webhook）の署名検証。
// WEBHOOK_VERIFY_MODE=enforce で署名が合わないものを拒否する。未設定・log のときはログに残すだけ。

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { resolveMode, type EnforceMode } from "@/steaklamp/lib/adminAllowList";

export type WebhookCheck =
  | { ok: true }
  | { ok: false; reason: "missing_secret" | "missing_headers" | "bad_signature" };

// LINE：本文を Channel secret で HMAC-SHA256 → base64 にした値が x-line-signature と一致するか
export function verifyLineSignature(
  rawBody: string,
  signature: string | null | undefined,
  channelSecret: string | null | undefined
): WebhookCheck {
  if (!channelSecret) return { ok: false, reason: "missing_secret" };
  if (!signature) return { ok: false, reason: "missing_headers" };

  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64");
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

// Resend（svix）：Resend SDK の webhooks.verify で署名と時刻（古いリクエストの再送）を検証する
export function verifyResendSignature(args: {
  rawBody: string;
  headers: Pick<Headers, "get">;
  secret: string | null | undefined;
}): WebhookCheck {
  if (!args.secret) return { ok: false, reason: "missing_secret" };

  const id = args.headers.get("svix-id");
  const timestamp = args.headers.get("svix-timestamp");
  const signature = args.headers.get("svix-signature");
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  try {
    // 検証だけに使う（通信は行わない）
    new Resend("re_verify_only").webhooks.verify({
      payload: args.rawBody,
      headers: { id, timestamp, signature },
      webhookSecret: args.secret,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}

export function getWebhookVerifyMode(): EnforceMode {
  return resolveMode(process.env.WEBHOOK_VERIFY_MODE);
}

// 検証結果を受けて、処理を続けてよいかを決める。拒否するときのレスポンスを返す（続行なら null）。
export function gateWebhook(
  label: string,
  check: WebhookCheck,
  mode: EnforceMode = getWebhookVerifyMode()
): NextResponse | null {
  if (check.ok) return null;

  console.warn(
    `STEAKLAMP_WEBHOOK_${mode === "enforce" ? "REJECTED" : "WOULD_REJECT"} route=${label} reason=${check.reason} mode=${mode}`
  );
  if (mode !== "enforce") return null;

  return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
}

// Resend 受信webhook用：ルートごとのシークレット（なければ共通のものを使う）
export function guardResendWebhook(args: {
  label: string;
  secretEnvName: string;
  headers: Pick<Headers, "get">;
  rawBody: string;
}) {
  const secret = process.env[args.secretEnvName] || process.env.RESEND_WEBHOOK_SECRET;
  return gateWebhook(
    args.label,
    verifyResendSignature({ rawBody: args.rawBody, headers: args.headers, secret })
  );
}

export function parseJsonBody(rawBody: string): any {
  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}
