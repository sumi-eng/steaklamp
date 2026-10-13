import { describe, expect, it } from "vitest";
import { parseIkyuReservationMail } from "../ikyu-parser";

// 新規・取消は実メール（個人情報は伏せ済み）。
// 変更は実メール未入手のため、新規メールと同じレイアウトで作った暫定サンプル。
const LINE = "---------------------------------------------------------------------";

const NEW_MAIL = `${LINE}
◆【新規】予約受付のお知らせ◆（席のみ）（通知NO：10000005）
${LINE}
Lamp 御中

お世話になっております。株式会社一休です。
以下の予約が申し込まれました。お手続きをお願い致します。

●予約サイト　　　：一休.comレストラン
●予約番号　　　　：IR0559295551
●来店日時　　　　：2026年10月12日（月） 19:00
●滞在時間（目安）：150分
●決済方法　　　　：現地決済
●来店人数　　　　：2人
●プランNo　　　　：12840052
●プラン　　　　　：(ディナー)席のみ予約
●席No　　　　　　：20596650
●席管理名称　　　：2~4名/テーブル/コネクト可/3卓
　　　　　　　　　　テーブル席(禁煙)（×1卓）

${LINE}
●明細
・プラン料金：なし　※席のみの予約です（お料理等料金は別途）

${LINE}
●お支払い金額：0円
※料金に消費税、及びサービス料を含む。

${LINE}
●来店代表者氏名　：〇〇 〇〇
●来店代表者連絡先：090XXXXXXXX
●コメント　　　　：カウンターをテーブルに変更してください。
●予約者氏名　　　：ゲスト予約

（以下、定型の案内文と一休の連絡先）
=====================================================================
`;

const CANCEL_MAIL = `${LINE}
◆【取消】（席のみ）予約取消完了のお知らせ◆（通知NO：10000007）
${LINE}
Lamp
ご担当者 様

お世話になっております。株式会社一休です。
以下の予約を取消しましたので、ご確認ください。

●予約サイト　　　：一休.comレストラン
●予約番号　　　　：IR0558748119
●来店日時　　　　：2026年10月27日（火） 19:00
●滞在時間（目安）：150分
●決済方法　　　　：現地決済
●利用人数　　　　：2人
●プランNo　　　　：12840052
●予約プラン　　　：(ディナー)席のみ予約
●席No　　　　　　：20596649
●席管理名称　　　：1名/カウンター/コネクト可/8卓
　　　　　　　　　　カウンター(禁煙)（×2卓）
●来店代表者氏名　：〇〇 〇〇
●来店代表者連絡先：090XXXXXXXX
●予約者氏名　　　：ゲスト予約
●キャンセル理由　：その他：「Googleで予約」経由のため省略

（以下、定型の案内文と一休の連絡先）
=====================================================================
`;

// 暫定: 変更メールの書式は未確認
const CHANGE_MAIL = NEW_MAIL.replace("◆【新規】予約受付のお知らせ◆", "◆【変更】予約変更のお知らせ◆")
  .replace("2026年10月12日（月） 19:00", "2026年10月12日（月） 20:00")
  .replace("●来店人数　　　　：2人", "●来店人数　　　　：3人");

const S_NEW = "【新規_現地決済】予約受付のお知らせ [予約NO：IR0559295551] 通知NO：10000005";
const S_CANCEL = "【取消】予約取消完了のお知らせ [予約NO：IR0558748119] 通知NO：10000007";

describe("一休 実メール", () => {
  it("新規", () => {
    const p = parseIkyuReservationMail(NEW_MAIL, S_NEW);
    expect(p.mailType).toBe("new");
    expect(p.externalId).toBe("IR0559295551");
    expect(p.date).toBe("2026-10-12");
    expect(p.time).toBe("19:00");
    expect(p.durationMinutes).toBe(150);
    expect(p.persons).toBe(2);
    expect(p.planName).toBe("(ディナー)席のみ予約");
    expect(p.paymentMethod).toBe("現地決済");
    expect(p.seatLabel).toContain("テーブル席(禁煙)");
    expect(p.comment).toBe("カウンターをテーブルに変更してください。");
  });

  it("新規: コメント欄の「変更」で変更メールと誤判定しない", () => {
    expect(parseIkyuReservationMail(NEW_MAIL, "").mailType).toBe("new");
  });

  it("取消: 利用人数・予約プラン・キャンセル理由を読める", () => {
    const p = parseIkyuReservationMail(CANCEL_MAIL, S_CANCEL);
    expect(p.mailType).toBe("cancel");
    expect(p.externalId).toBe("IR0558748119");
    expect(p.persons).toBe(2);
    expect(p.planName).toBe("(ディナー)席のみ予約");
    expect(p.cancelReason).toBe("その他：「Googleで予約」経由のため省略");
    expect(p.date).toBe("2026-10-27");
  });

  it("取消: 本文が読めなくても件名の予約NOで予約番号を取れる", () => {
    const p = parseIkyuReservationMail("本文なし", S_CANCEL);
    expect(p.mailType).toBe("cancel");
    expect(p.externalId).toBe("IR0558748119");
  });

  it("変更（暫定サンプル）", () => {
    const p = parseIkyuReservationMail(CHANGE_MAIL, "【変更】予約変更のお知らせ [予約NO：IR0559295551]");
    expect(p.mailType).toBe("change");
    expect(p.externalId).toBe("IR0559295551");
    expect(p.time).toBe("20:00");
    expect(p.persons).toBe(3);
  });
});

describe("一休 件名による判定", () => {
  it.each([
    ["【新規_現地決済】予約受付のお知らせ [予約NO：IR1]", "new"],
    ["【新規_事前決済】予約受付のお知らせ [予約NO：IR1]", "new"],
    ["【取消】予約取消完了のお知らせ [予約NO：IR1]", "cancel"],
    ["【変更】予約変更のお知らせ [予約NO：IR1]", "change"],
  ])("%s → %s", (subject, expected) => {
    expect(parseIkyuReservationMail("●予約番号　：IR1", subject).mailType).toBe(expected);
  });

  it.each([
    "【一休.comレストラン レストラン情報変更通知】Lamp 様",
    "【株式会社一休】_ご精算のご案内（2026年9月分）",
    "【一休.comレストラン 送信テスト】テストメール",
    "お打ち合わせのお礼",
  ])("予約以外は ignore: %s", (subject) => {
    expect(parseIkyuReservationMail(NEW_MAIL, subject).mailType).toBe("ignore");
  });

  it("知らない件名で本文の見出しも判定できなければ unknown（要確認）", () => {
    expect(parseIkyuReservationMail("●予約番号　：IR1", "新サービスのご案内").mailType).toBe("unknown");
  });

  it("知らない件名でも本文の見出し行が明確なら本文で判定する", () => {
    expect(parseIkyuReservationMail(CANCEL_MAIL, "一休からのお知らせ").mailType).toBe("cancel");
  });

  it("件名と本文の見出しが食い違う場合は unknown（要確認）", () => {
    expect(parseIkyuReservationMail(CANCEL_MAIL, S_NEW).mailType).toBe("unknown");
  });
});
