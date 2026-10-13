import { describe, expect, it } from "vitest";
import {
  applyPointNote,
  buildPointNoteLine,
  parseHotpepperReservationMail,
} from "../hotpepper-parser";

// 実メール（個人情報は伏せ済み）。
//  - 新規:     2026-10-09 受信  件名「[即予約]予約が確定しました」
//  - 変更:     2026-10-09 受信  件名「[即予約]予約内容が変更されました」
//  - キャンセル: 2026-08-12 受信  件名「[即予約]予約がキャンセルされました」
const FOOTER = `
--------------------------------------------------------------
【レストランボード】
--------------------------------------------------------------
https://restaurant-board.com/CLP/view/login

───────────────────────────────────────┐
□■ 本メールの内容にお心当たりのない方は
───────────────────────────────────────┘
このメールは貴店の「ホットペッパーグルメ店舗管理画面」のサイト上より、
「通知メール設定」からご登録いただいたメールアドレスに配信しております。
`;

const GREETING = `「隠れ家ダイニング Lamp 徳島秋田町店」様
レストランボード・ホットペッパーグルメからのお知らせです。
`;

const NEW_MAIL = `${GREETING}
【即予約】の申し込み

■予約経路：ホットペッパーグルメ
■予約依頼番号：SE3948742
■来店日時：2026年10月10日(土) 18:00
■代表者：モリモト　アキ様
■コース：お席のみのご予約
■席情報：Ｔ1～Ｔ３
　　　　　テーブル（喫煙可）
■人数：2名様
■ポイント発行額：100ポイント
　内訳：基本ポイント　100ポイント(50ポイント×2名)
■ポイント利用額：0ポイント
■質問と回答
Q. 苦手なもの、アレルギー等がございましたらご記入ください
A.

※当予約に対して、2026年10月9日(金) 23:00まで、ユーザ画面からキャンセル/変更される可能性があります。
${FOOTER}`;

const NEW_MAIL_WITH_ANSWER = NEW_MAIL.replace("A.\n", "A. エビアレルギー\n");

const CHANGE_MAIL = `${GREETING}
【即予約】の変更

■予約経路：ホットペッパーグルメ
■予約依頼番号：SE3894084
■代表者：ヨシダ　ナナミ様
■コース：お席のみのご予約
■席情報：Ｔ1～Ｔ３
　　　　　テーブル（喫煙可）
■ポイント利用額：0ポイント

【予約変更内容】
■来店日時：2026年10月12日(月) 19:00 → 2026年10月12日(月) 20:00
■人数：2名様 → 2名様
■ポイント発行額
　変更前：100ポイント
　　内訳：基本ポイント　100ポイント(50ポイント×2名)
　変更後：100ポイント
　　内訳：基本ポイント　100ポイント(50ポイント×2名)
${FOOTER}`;

const CANCEL_MAIL = `${GREETING}
【即予約】のキャンセル

■予約経路：ホットペッパーグルメ
■予約依頼番号：SDW426155
■来店日時：2026年8月21日(金) 19:00
■代表者：ミヤモト　モモカ様
■コース：お席のみのご予約
■席情報：Ｔ1～Ｔ３
　　　　　テーブル（喫煙可）
■人数：2名様
${FOOTER}`;

const S_NEW = "[即予約]予約が確定しました";
const S_CHANGE = "[即予約]予約内容が変更されました";
const S_CANCEL = "[即予約]予約がキャンセルされました";

describe("ホットペッパー実メール", () => {
  it("新規（確定）", () => {
    const p = parseHotpepperReservationMail(NEW_MAIL, S_NEW);
    expect(p.mailType).toBe("new");
    expect(p.externalId).toBe("SE3948742");
    expect(p.date).toBe("2026-10-10");
    expect(p.time).toBe("18:00");
    expect(p.persons).toBe(2);
    expect(p.name).toBe("モリモト　アキ");
    expect(p.planName).toBe("お席のみのご予約");
  });

  it("新規: アレルギー回答が空のとき注意書きを拾わない", () => {
    expect(parseHotpepperReservationMail(NEW_MAIL, S_NEW).questionAnswerText).toBe("");
  });

  it("新規: アレルギー回答を取得できる", () => {
    expect(parseHotpepperReservationMail(NEW_MAIL_WITH_ANSWER, S_NEW).questionAnswerText).toBe(
      "エビアレルギー"
    );
  });

  it("変更: 変更後の日時を採用する", () => {
    const p = parseHotpepperReservationMail(CHANGE_MAIL, S_CHANGE);
    expect(p.mailType).toBe("change");
    expect(p.externalId).toBe("SE3894084");
    expect(p.date).toBe("2026-10-12");
    expect(p.time).toBe("20:00");
    expect(p.persons).toBe(2);
  });

  it("キャンセル", () => {
    const p = parseHotpepperReservationMail(CANCEL_MAIL, S_CANCEL);
    expect(p.mailType).toBe("cancel");
    expect(p.externalId).toBe("SDW426155");
    expect(p.date).toBe("2026-08-21");
    expect(p.time).toBe("19:00");
  });
});

describe("件名による判定", () => {
  it.each([
    ["[即予約]予約が確定しました", "new"],
    ["[即予約]予約内容が変更されました", "change"],
    ["[即予約]予約がキャンセルされました", "cancel"],
  ])("%s → %s", (subject, expected) => {
    // 件名だけで決まる（本文が見出し無しでも同じ結果）
    expect(parseHotpepperReservationMail("■予約依頼番号：SE1", subject).mailType).toBe(expected);
  });

  it.each([
    "明日の予約のお知らせ",
    "[ネット予約]昨日来店予定の予約確認",
    "【ご確認ください】店舗管理画面の設定について",
  ])("対象外の件名: %s", (subject) => {
    expect(parseHotpepperReservationMail(NEW_MAIL, subject).mailType).toBe("ignore");
  });

  it("知らない件名で本文も判定できなければ unknown（要確認）", () => {
    expect(parseHotpepperReservationMail("■予約依頼番号：SE1", "新機能のお知らせ").mailType).toBe(
      "unknown"
    );
  });

  it("知らない件名でも本文の見出しが明確なら本文で判定する", () => {
    expect(parseHotpepperReservationMail(CANCEL_MAIL, "[リクエスト予約]通知").mailType).toBe("cancel");
  });

  it("件名と本文が食い違う場合は unknown（要確認）", () => {
    expect(parseHotpepperReservationMail(CANCEL_MAIL, S_NEW).mailType).toBe("unknown");
  });
});

describe("件名の末尾に注記が付く場合（前方一致）", () => {
  it.each([
    ["[即予約]予約が確定しました　＊ポイント利用予約です", "new"],
    ["[即予約]予約内容が変更されました　＊ポイント利用予約です", "change"],
    ["[即予約]予約がキャンセルされました　＊ポイント利用予約です", "cancel"],
  ])("%s → %s", (subject, expected) => {
    expect(parseHotpepperReservationMail("■予約依頼番号：SE1", subject).mailType).toBe(expected);
  });
});

describe("ポイント利用", () => {
  // ※ポイント利用予約の実メールは未入手。実メールの「■ポイント利用額：0ポイント」の書式を元にした暫定サンプル。
  const withPoints = (mail: string, from: string, to: string) =>
    mail.replace(`■ポイント利用額：${from}`, `■ポイント利用額：${to}`);

  it("0ポイントは備考に入れない", () => {
    const p = parseHotpepperReservationMail(CHANGE_MAIL, S_CHANGE);
    expect(p.pointsUsed).toBe(0);
    expect(buildPointNoteLine(p.pointsUsed)).toBeNull();
  });

  it("1ポイント以上は「ポイント利用：〇〇ポイント」にする", () => {
    const mail = withPoints(CHANGE_MAIL, "0ポイント", "500ポイント");
    const p = parseHotpepperReservationMail(mail, S_CHANGE);
    expect(p.pointsUsed).toBe(500);
    expect(buildPointNoteLine(p.pointsUsed)).toBe("ポイント利用：500ポイント");
  });

  it("桁区切りのあるポイントを読める", () => {
    const mail = withPoints(CHANGE_MAIL, "0ポイント", "1,200ポイント");
    const p = parseHotpepperReservationMail(mail, S_CHANGE);
    expect(p.pointsUsed).toBe(1200);
    expect(buildPointNoteLine(p.pointsUsed)).toBe("ポイント利用：1,200ポイント");
  });

  it("変更メールの矢印は変更後の値を使う", () => {
    const mail = withPoints(CHANGE_MAIL, "0ポイント", "500ポイント → 1000ポイント");
    expect(parseHotpepperReservationMail(mail, S_CHANGE).pointsUsed).toBe(1000);
  });

  it("ポイント利用額の行が無ければ null", () => {
    expect(parseHotpepperReservationMail("■予約依頼番号：SE1", S_NEW).pointsUsed).toBeNull();
  });

  it("変更時: 既存の備考（要望・アレルギー）を残し、ポイントの行を最新に差し替える", () => {
    const existing = "ホットペッパー予約\n苦手なもの・アレルギー:エビ\nポイント利用：500ポイント";
    expect(applyPointNote(existing, 1000)).toBe(
      "ホットペッパー予約\n苦手なもの・アレルギー:エビ\nポイント利用：1,000ポイント"
    );
  });

  it("変更時: 0ポイントになったら古いポイントの行を外す。他の備考は残す", () => {
    const existing = "ホットペッパー予約\n苦手なもの・アレルギー:エビ\nポイント利用：500ポイント";
    expect(applyPointNote(existing, 0)).toBe("ホットペッパー予約\n苦手なもの・アレルギー:エビ");
  });

  it("変更時: メールにポイント利用額が無ければ既存の備考をそのまま返す", () => {
    const existing = "ホットペッパー予約\nポイント利用：500ポイント";
    expect(applyPointNote(existing, null)).toBe(existing);
  });
});
