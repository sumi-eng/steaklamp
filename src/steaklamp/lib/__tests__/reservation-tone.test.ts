import { describe, expect, it } from "vitest";
import {
  getReservationTone,
  hasRealNotes,
  isSeatOnlyCourse,
} from "../reservationTone";

// 取り込み処理（hotpepper-import / ikyu-import / tabelog route / christmas reserve）が
// 実際に作る備考の形をそのまま使う。

const HP_AUTO_ONLY = [
  "ホットペッパー予約",
  "席情報: Ｔ1～Ｔ３ テーブル（喫煙可）",
  "メールコース名: お席のみのご予約",
].join("\n");

const HP_WITH_POINT = `${HP_AUTO_ONLY}\nポイント利用：500ポイント`;

const HP_WITH_ALLERGY = [
  "ホットペッパー予約",
  "席情報: Ｔ1～Ｔ３ テーブル（喫煙可）",
  "メールコース名: お席のみのご予約",
  "苦手なもの・アレルギー:エビアレルギー",
].join("\n");

const HP_WITH_REQUEST = [
  "ホットペッパー予約",
  "メールコース名: Aコース 7,200円",
  "ご要望事項:\n記念日のため、デザートプレートをお願いします",
].join("\n");

const HP_AFTER_CHANGE = [
  HP_AUTO_ONLY,
  "ホットペッパー: 変更通知を受信（来店日時: 2026年10月12日(月) 19:00 → 2026-10-12 20:00 / 人数: 2名）",
].join("\n");

const IKYU_AUTO_ONLY = [
  "一休予約",
  "ふりがな: ヤマダ タロウ",
  "人数: 大人2名",
  "席情報: 右テーブル",
  "メールプラン名: (ディナー)席のみ予約",
  "決済方法: 現地払い",
].join("\n");

const IKYU_WITH_COMMENT = `${IKYU_AUTO_ONLY}\nコメント:\nアレルギーあり`;

const TABELOG_AUTO_ONLY = [
  "メールコース名: お席のみのご予約",
  "食べログ席情報: テーブル席",
].join("\n");

const TABELOG_WITH_REQUEST = `${TABELOG_AUTO_ONLY}\nご要望事項: エビアレルギーです`;

const CHRISTMAS_NONE = [
  "クリスマスコース（自社サイト）",
  "アレルギー・苦手な食材: なし",
  "キャンセルポリシーに同意済み",
].join("\n");

const CHRISTMAS_ALLERGY = [
  "クリスマスコース（自社サイト）",
  "アレルギー・苦手な食材: 甲殻類",
  "キャンセルポリシーに同意済み",
].join("\n");

describe("hasRealNotes", () => {
  it("備考が空なら備考なし", () => {
    expect(hasRealNotes(null)).toBe(false);
    expect(hasRealNotes(undefined)).toBe(false);
    expect(hasRealNotes("")).toBe(false);
    expect(hasRealNotes("  \n \n")).toBe(false);
  });

  it("取り込み時の自動行だけなら備考なし", () => {
    expect(hasRealNotes(HP_AUTO_ONLY)).toBe(false);
    expect(hasRealNotes(HP_WITH_POINT)).toBe(false);
    expect(hasRealNotes(HP_AFTER_CHANGE)).toBe(false);
    expect(hasRealNotes(IKYU_AUTO_ONLY)).toBe(false);
    expect(hasRealNotes(TABELOG_AUTO_ONLY)).toBe(false);
    expect(hasRealNotes("食べログ予約")).toBe(false);
    expect(hasRealNotes("予約変更の記録: 席を変更")).toBe(false);
    expect(hasRealNotes(CHRISTMAS_NONE)).toBe(false);
  });

  it("見出しだけ・「なし」の要望は備考なし", () => {
    expect(hasRealNotes(`${IKYU_AUTO_ONLY}\nコメント:\nなし`)).toBe(false);
    expect(hasRealNotes(`${HP_AUTO_ONLY}\nご要望事項:\n`)).toBe(false);
    expect(hasRealNotes(`${HP_AUTO_ONLY}\n苦手なもの・アレルギー:特になし`)).toBe(false);
  });

  it("お客様の要望・アレルギーがあれば備考あり", () => {
    expect(hasRealNotes(HP_WITH_ALLERGY)).toBe(true);
    expect(hasRealNotes(HP_WITH_REQUEST)).toBe(true);
    expect(hasRealNotes(IKYU_WITH_COMMENT)).toBe(true);
    expect(hasRealNotes(TABELOG_WITH_REQUEST)).toBe(true);
    expect(hasRealNotes(CHRISTMAS_ALLERGY)).toBe(true);
  });

  it("要望に加えて変更通知の行が追記されても備考あり", () => {
    expect(hasRealNotes(`${HP_WITH_ALLERGY}\n${HP_AFTER_CHANGE.split("\n").pop()}`)).toBe(true);
  });

  it("スタッフが手で書いた備考があれば備考あり", () => {
    expect(hasRealNotes("結婚記念日。花束あり")).toBe(true);
    expect(hasRealNotes(`${HP_AUTO_ONLY}\n窓側希望・遅れて来店`)).toBe(true);
  });
});

describe("isSeatOnlyCourse", () => {
  it("席のみ系の名前・未設定は席のみ", () => {
    for (const c of [null, undefined, "", "席のみ", "お席のみのご予約", "(ディナー)席のみ予約"]) {
      expect(isSeatOnlyCourse(c)).toBe(true);
    }
  });

  it("コース名があれば席のみではない", () => {
    for (const c of ["Aコース", "Bコース", "Cコース", "クリスマスコース"]) {
      expect(isSeatOnlyCourse(c)).toBe(false);
    }
  });
});

describe("getReservationTone", () => {
  it("席のみ・備考なし（自動行のみ）は青", () => {
    expect(getReservationTone({ courseName: "お席のみのご予約", notes: HP_AUTO_ONLY })).toBe("blue");
    expect(getReservationTone({ courseName: "席のみ", notes: null })).toBe("blue");
  });

  it("コースあり・備考なし（自動行のみ）は黄", () => {
    expect(getReservationTone({ courseName: "Aコース", notes: "ホットペッパー予約\nメールコース名: Aコース 7,200円" })).toBe("yellow");
    expect(getReservationTone({ courseName: "クリスマスコース", notes: CHRISTMAS_NONE })).toBe("yellow");
  });

  it("備考ありは赤。コースと両方あっても赤を優先", () => {
    expect(getReservationTone({ courseName: "席のみ", notes: HP_WITH_ALLERGY })).toBe("red");
    expect(getReservationTone({ courseName: "Bコース", notes: IKYU_WITH_COMMENT })).toBe("red");
    expect(getReservationTone({ courseName: "クリスマスコース", notes: CHRISTMAS_ALLERGY })).toBe("red");
  });

  it("キャンセル済みは色分け対象外（灰）", () => {
    expect(getReservationTone({ status: "cancelled", courseName: "Aコース", notes: HP_WITH_ALLERGY })).toBe("gray");
  });
});
