import { describe, expect, it } from "vitest";
import { isAllowedAdmin, parseAdminEmails } from "../adminAllowList";

const LIST = "Owner@example.com, staff@example.com";

describe("管理者の判定", () => {
  it("許可リストのGoogleアカウントだけが管理者（大文字小文字は区別しない）", () => {
    expect(isAllowedAdmin({ provider: "google", email: "owner@example.com" }, LIST)).toBe(true);
    expect(isAllowedAdmin({ provider: "google", email: "STAFF@example.com" }, LIST)).toBe(true);
  });

  it("リストに無いアカウントは管理者ではない（お客様のGoogleログインを含む）", () => {
    expect(isAllowedAdmin({ provider: "google", email: "customer@example.com" }, LIST)).toBe(false);
  });

  it("Google以外のログインは、メールが一致しても認めない", () => {
    expect(isAllowedAdmin({ provider: "line", email: "owner@example.com" }, LIST)).toBe(false);
    expect(isAllowedAdmin({ provider: "facebook", email: "owner@example.com" }, LIST)).toBe(false);
    expect(isAllowedAdmin({ email: "owner@example.com" }, LIST)).toBe(false);
  });

  it("未ログイン・メール無し・リスト未設定は拒否する", () => {
    expect(isAllowedAdmin(null, LIST)).toBe(false);
    expect(isAllowedAdmin({ provider: "google", email: null }, LIST)).toBe(false);
    expect(isAllowedAdmin({ provider: "google", email: "owner@example.com" }, "")).toBe(false);
    expect(isAllowedAdmin({ provider: "google", email: "owner@example.com" }, undefined)).toBe(false);
  });

  it("許可リストは カンマ・空白・セミコロン区切りを読める", () => {
    expect(parseAdminEmails("a@x.com; B@x.com  c@x.com,,")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});
