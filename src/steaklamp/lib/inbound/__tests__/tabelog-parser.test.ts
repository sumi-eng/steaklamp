import { describe, expect, it } from "vitest";
import { parseTabelogReservationMail } from "../tabelog-parser";

// 実メール（個人情報は伏せ済み）。送信元 owner_support@tabelog.com
//  - 新規:       「【新規予約】新しい予約が入りました。（2月21日(土) 18:30- 4名様）」
//  - 変更:       件名は未確認。本文は実メール、件名は暫定
//  - キャンセル: 「【予約キャンセル】予約がキャンセルされました。（1月2日(金) 18:00-…）」
const PREAMBLE = `Lamp  様
----------------------------------------
！本メールは食べログより自動送信している予約通知メールです！
※ご返信されても予約者様には送信されません。
　予約者様の電話番号・メールアドレスをご確認の上、直接、
　ご連絡をお願いいたします。
※本メールにご返信いただいてもお答えできませんので、ご了承ください。
----------------------------------------
`;

const POLICY = `キャンセルポリシー：
                    本予約をキャンセルされた場合、下記の料金を頂戴いたします。
                    当日キャンセル（連絡なし）：5,000円（1名あたり）
`;

const NEW_MAIL = `${PREAMBLE}
食べログのインターネット予約サービスに新しい予約が入りました。

お名前          ：〇〇（〇〇） 様
電話番号        ：090XXXXXXXX
日付            ：02/21
来店時刻        ：18:30
滞在可能時間    ：2時間
人数            ：4名
コース          ：お席のみのご予約
利用Vポイント   ：Vポイントが「使える」お店になっていません
卓             ：テーブル1 (テーブル席)[喫煙]
ご要望          ：
${POLICY}
上記予約情報を店舗様でお使いの予約台帳に転記頂きますよう
お願い申し上げます。

なお、お客様のお名前(フルネーム)などの詳細な個人情報につきましては
下記管理画面よりご確認ください。

  https://owner.tabelog.com/tn/time-schedule/2026-02-21?bookingId=net:48912424

============================================
食べログでは、お客様がネット予約を完了したタイミングおよび予約完了メールにおいて
「ご連絡なくご来店が遅れると、レストランによってご予約内容が
キャンセルされる場合があります」という注意喚起を行っています。
============================================
（以下、食べログ店舗会員サポートの連絡先）
`;

const CHANGE_MAIL = `${PREAMBLE}
お客様により下記予約内容が変更されました。
※お客様によって変更が可能な項目は、「ご要望欄への追記」、
　「日付変更」、「来店時間変更」と「人数変更」のみです。

お名前           ：〇〇（〇〇） 様
電話番号          ：090XXXXXXXX
日付              ：02/21 → 02/28
来店時刻          ：18:30
滞在可能時間      ：2時間
人数              ：4名
コース            ：お席のみのご予約
利用Vポイント   ：Vポイントが「使える」お店になっていません
卓               ：テーブル1 (テーブル席)[喫煙]
ご要望            ：

変更時のメッセージ：
${POLICY}
なお、お客様のお名前(フルネーム)などの詳細な個人情報につきましては
下記管理画面よりご確認の上、予約台帳の修正をお願い申し上げます。

  https://owner.tabelog.com/tn/time-schedule/2026-02-28?bookingId=net:48912424

============================================
食べログでは、お客様がネット予約を完了したタイミングおよび予約完了メールにおいて
「ご連絡なくご来店が遅れると、レストランによってご予約内容が
キャンセルされる場合があります」という注意喚起を行っています。
============================================
`;

const CANCEL_MAIL = `${PREAMBLE}
お客様により下記予約内容がキャンセルされました。

お名前           ：〇〇（〇〇） 様
電話番号          ：090XXXXXXXX
日付              ：01/02
来店時刻          ：18:00
滞在可能時間      ：2時間
人数              ：4名
コース            ：お席のみのご予約
卓               ：テーブル1 (テーブル席)[喫煙]
ご要望            ：

キャンセル理由    ：【予定がなくなったため】予定が変更になった

${POLICY}
個人情報はメールでご確認いただくことができません。
必ず下記管理画面にて【お客様のお名前(フルネーム)】等の個人情報をご確認いただき
予約台帳の修正をお願い申し上げます。

  https://owner.tabelog.com/tn/time-schedule/2026-01-02?bookingId=net:42791350

（以下、連絡先）
`;

const S_NEW = "【新規予約】新しい予約が入りました。（2月21日(土) 18:30- 4名様）";
const S_CHANGE = "【予約変更】予約内容が変更されました。 (2月28日(土) 18:30 4名様)【食べログネット予約】";
const S_CANCEL = "【予約キャンセル】予約がキャンセルされました。（1月2日(金) 18:00- 4名様）";

describe("食べログ 実メール", () => {
  it("新規", () => {
    const p = parseTabelogReservationMail(NEW_MAIL, S_NEW);
    expect(p.mailType).toBe("new");
    expect(p.externalId).toBe("net:48912424");
    expect(p.date).toBe("2026-02-21"); // 年はURLから
    expect(p.time).toBe("18:30");
    expect(p.persons).toBe(4);
    expect(p.durationMinutes).toBe(120);
    expect(p.name).toBe("〇〇（〇〇）");
    expect(p.phone).toBe("090XXXXXXXX");
    expect(p.planName).toBe("お席のみのご予約");
    expect(p.seatLabel).toBe("テーブル1 (テーブル席)[喫煙]");
  });

  it("新規: ご要望が空のとき、後続のキャンセルポリシー等を拾わない", () => {
    expect(parseTabelogReservationMail(NEW_MAIL, S_NEW).requestText).toBe("");
  });

  it("新規: ご要望が入っていれば取得できる", () => {
    const mail = NEW_MAIL.replace("ご要望          ：\n", "ご要望          ：エビアレルギーです\n");
    expect(parseTabelogReservationMail(mail, S_NEW).requestText).toBe("エビアレルギーです");
  });

  it("新規: 本文のキャンセルポリシー等の語で判定が変わらない", () => {
    expect(parseTabelogReservationMail(NEW_MAIL, "").mailType).toBe("new");
  });

  it("変更: 変更後の日付(URLの年付き日付)を採用し、予約番号は新規と同じ", () => {
    const p = parseTabelogReservationMail(CHANGE_MAIL, S_CHANGE);
    expect(p.mailType).toBe("change");
    expect(p.externalId).toBe("net:48912424");
    expect(p.date).toBe("2026-02-28");
    expect(p.prevDate).toBe("02/21");
    expect(p.time).toBe("18:30");
    expect(p.persons).toBe(4);
  });

  it("変更: 件名が不明でも本文の冒頭文で判定でき、ポリシーが変更時のメッセージに混ざらない", () => {
    const p = parseTabelogReservationMail(CHANGE_MAIL, "");
    expect(p.mailType).toBe("change");
    expect(p.changeMessage).toBe("");
  });

  it("変更: 変更時のメッセージを取得できる", () => {
    const mail = CHANGE_MAIL.replace("変更時のメッセージ：\n", "変更時のメッセージ：\n1名増えるかもしれません\n");
    expect(parseTabelogReservationMail(mail, S_CHANGE).changeMessage).toBe("1名増えるかもしれません");
  });

  it("変更: 矢印付きの来店時刻・人数は変更後を採用する", () => {
    const mail = CHANGE_MAIL.replace("18:30\n滞在", "18:30 → 19:00\n滞在").replace(
      "人数              ：4名",
      "人数              ：4名 → 5名"
    );
    const p = parseTabelogReservationMail(mail, S_CHANGE);
    expect(p.time).toBe("19:00");
    expect(p.persons).toBe(5);
  });

  it("キャンセル: 理由の「変更」で変更と誤判定しない", () => {
    const p = parseTabelogReservationMail(CANCEL_MAIL, S_CANCEL);
    expect(p.mailType).toBe("cancel");
    expect(p.externalId).toBe("net:42791350");
    expect(p.cancelReason).toBe("【予定がなくなったため】予定が変更になった");
    expect(p.date).toBe("2026-01-02");
  });

  it("キャンセル: 件名が不明でも本文の冒頭文で判定できる（理由の「変更」に反応しない）", () => {
    expect(parseTabelogReservationMail(CANCEL_MAIL, "").mailType).toBe("cancel");
  });
});

describe("食べログ 年の補完（URLが無い場合）", () => {
  const withoutUrl = (mail: string) => mail.replace(/https:\/\/owner\.tabelog\.com\S*/g, "");
  const received = (iso: string) => new Date(iso);

  it("同じ年の予約はそのままの年にする", () => {
    // 2026-02-10(JST)受信の 02/21 → 2026年
    const p = parseTabelogReservationMail(withoutUrl(NEW_MAIL), S_NEW, received("2026-02-10T03:00:00Z"));
    expect(p.date).toBe("2026-02-21");
  });

  it("12月に届いた1月の予約は翌年にする", () => {
    const mail = withoutUrl(NEW_MAIL).replace("日付            ：02/21", "日付            ：01/05");
    const p = parseTabelogReservationMail(mail, S_NEW, received("2026-12-20T03:00:00Z"));
    expect(p.date).toBe("2027-01-05");
  });

  it("年末の受信でも当年内の予約は翌年にしない", () => {
    const mail = withoutUrl(NEW_MAIL).replace("日付            ：02/21", "日付            ：12/28");
    const p = parseTabelogReservationMail(mail, S_NEW, received("2026-12-20T03:00:00Z"));
    expect(p.date).toBe("2026-12-28");
  });

  it("受信日のJSTが翌年になる場合はJSTの年で補う", () => {
    // 2026-12-31T16:00Z = 2027-01-01 01:00 JST
    const mail = withoutUrl(NEW_MAIL).replace("日付            ：02/21", "日付            ：01/10");
    const p = parseTabelogReservationMail(mail, S_NEW, received("2026-12-31T16:00:00Z"));
    expect(p.date).toBe("2027-01-10");
  });

  it("URLがあればURLの年付き日付を優先する", () => {
    const p = parseTabelogReservationMail(NEW_MAIL, S_NEW, received("2030-01-01T00:00:00Z"));
    expect(p.date).toBe("2026-02-21");
  });
});

describe("食べログ 件名による判定", () => {
  it("実際の変更メールの件名（末尾の【食べログネット予約】）を無視対象にしない", () => {
    expect(parseTabelogReservationMail(CHANGE_MAIL, S_CHANGE).mailType).toBe("change");
  });

  it.each([
    "【注意喚起】ご予約のお客様へのご連絡について",
    "【食べログ】インターネット予約、月末付近の予約変更・キャンセルについて",
    "【食べログ】「ネット予約情報連絡用メールアドレス」の定期確認",
    "【食べログ】2026年9月分ご請求金額のお知らせ",
    "【本日のご来店一覧】2026年10月13日",
  ])("予約以外は ignore: %s", (subject) => {
    // 本文が新規メールでも、件名が対象外なら台帳を変更しない
    expect(parseTabelogReservationMail(NEW_MAIL, subject).mailType).toBe("ignore");
  });

  it("知らない件名で本文の冒頭文も判定できなければ unknown（要確認）", () => {
    expect(parseTabelogReservationMail("お知らせです", "新サービスのご案内").mailType).toBe("unknown");
  });

  it("件名と本文の冒頭文が食い違う場合は unknown（要確認）", () => {
    expect(parseTabelogReservationMail(CANCEL_MAIL, S_NEW).mailType).toBe("unknown");
  });
});
