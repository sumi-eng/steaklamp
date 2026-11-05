// クリスマスコースの予約確認メール・前日リマインドメール。

import { Resend } from "resend";
import {
  CHRISTMAS,
  CHRISTMAS_CANCEL_POLICY,
  CHRISTMAS_MENU,
  CHRISTMAS_PRICE_TEXT,
  dateLabel,
  jstDateKey,
  jstTimeKey,
} from "@/steaklamp/lib/christmas";

type MailReservation = {
  name: string | null;
  email: string | null;
  phone: string | null;
  persons: number | null;
  start_at: string;
  notes: string | null;
};

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getResend() {
  return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
}

function fromAddress() {
  return (
    process.env.STEAKLAMP_FROM_EMAIL ??
    process.env.RESEND_FROM_EMAIL ??
    process.env.RESEND_FROM ??
    "Passion for Grilling Lamp <onboarding@resend.dev>"
  );
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://steaklamp-m2og.vercel.app";
}

function detailRows(r: MailReservation, withContact: boolean) {
  const dateText = `${dateLabel(jstDateKey(r.start_at))} ${jstTimeKey(r.start_at)}〜`;
  const rows: Array<[string, string]> = [
    ["日時", dateText],
    ["人数", `${r.persons ?? "-"}名`],
    ["コース", `${CHRISTMAS.courseName}（${CHRISTMAS_PRICE_TEXT}）`],
  ];
  if (CHRISTMAS_MENU.length > 0) {
    rows.push(["コース内容", CHRISTMAS_MENU.map(esc).join("<br />")]);
  }
  if (withContact) {
    rows.push(["お名前", `${esc(r.name)} 様`]);
    rows.push(["電話", esc(r.phone)]);
    rows.push(["メール", esc(r.email)]);
  }
  return rows;
}

function table(rows: Array<[string, string]>) {
  return `<table style="border-collapse: collapse; line-height: 1.8;">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding-right:16px; vertical-align:top;">${k}</td><td>${v}</td></tr>`
    )
    .join("")}</table>`;
}

function policyHtml() {
  return `<ul style="padding-left:20px; margin:8px 0;">${CHRISTMAS_CANCEL_POLICY.map(
    (p) => `<li>${esc(p)}</li>`
  ).join("")}</ul>`;
}

function cancelUrl(token: string) {
  return `${siteUrl()}/steaklamp/reserve/cancel?token=${token}`;
}

export async function sendChristmasConfirmationEmails(args: {
  reservation: MailReservation;
  cancelToken: string;
  allergy: string;
}) {
  const resend = getResend();
  if (!resend) return;
  const from = fromAddress();
  const storeEmail = process.env.STEAKLAMP_STORE_EMAIL ?? "lamp@japanblue.net";
  const r = args.reservation;
  const url = cancelUrl(args.cancelToken);

  const customerHtml = `
    <div style="font-family: sans-serif; line-height: 1.8; color: #222;">
      <h2>【Passion for Grilling Lamp】クリスマスコースのご予約ありがとうございます</h2>
      <p>${esc(r.name)} 様</p>
      <p>以下の内容でご予約を承りました。</p>
      ${table([
        ...detailRows(r, false),
        ["アレルギー・苦手な食材", esc(args.allergy)],
      ])}
      <h3 style="margin-top:24px;">キャンセルポリシー</h3>
      ${policyHtml()}
      <p style="margin-top:16px;">
        2日前までのキャンセルはこちらからお願いいたします。<br />
        <a href="${url}">${url}</a>
      </p>
      <p style="font-size:13px; color:#666;">お支払いはご来店時にお願いいたします。</p>
    </div>
  `;

  const storeHtml = `
    <div style="font-family: sans-serif; line-height: 1.8; color: #222;">
      <h2>【Passion for Grilling Lamp】クリスマスコースの予約が入りました</h2>
      ${table([
        ...detailRows(r, true),
        ["アレルギー・苦手な食材", esc(args.allergy)],
      ])}
      <p style="margin-top:16px;">キャンセルURL：<a href="${url}">${url}</a></p>
    </div>
  `;

  if (r.email) {
    await resend.emails.send({
      from,
      to: r.email,
      subject: "【Passion for Grilling Lamp】クリスマスコースのご予約を承りました",
      html: customerHtml,
    });
  }
  if (storeEmail) {
    await resend.emails.send({
      from,
      to: storeEmail,
      subject: "【Passion for Grilling Lamp】クリスマスコースの予約が入りました",
      html: storeHtml,
    });
  }
}

// 前日リマインド。前日・当日のキャンセルは電話のみで、キャンセル料がかかることを案内する。
export async function sendChristmasReminderEmail(r: MailReservation) {
  const resend = getResend();
  if (!resend || !r.email) return false;

  const html = `
    <div style="font-family: sans-serif; line-height: 1.8; color: #222;">
      <h2>【Passion for Grilling Lamp】明日はクリスマスコースのご予約日です</h2>
      <p>${esc(r.name)} 様</p>
      <p>ご来店を心よりお待ちしております。ご予約内容をご確認ください。</p>
      ${table(detailRows(r, false))}
      <h3 style="margin-top:24px;">キャンセル・ご変更について</h3>
      <p>前日・当日のキャンセル・ご変更はお電話（${CHRISTMAS.phone}）にてお願いいたします。<br />
      前日のキャンセルはコース料金の50%、当日のキャンセルは100%のキャンセル料がかかります。</p>
    </div>
  `;

  await resend.emails.send({
    from: fromAddress(),
    to: r.email,
    subject: "【Passion for Grilling Lamp】明日のクリスマスコースのご案内",
    html,
  });
  return true;
}
