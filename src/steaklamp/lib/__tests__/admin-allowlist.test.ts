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

import { decideAdminAccess, resolveMode } from "../adminAllowList";

describe("切り替えモード", () => {
  it("enforce 以外（未設定・log・誤記）は log として扱う", () => {
    expect(resolveMode("enforce")).toBe("enforce");
    expect(resolveMode(" ENFORCE ")).toBe("enforce");
    expect(resolveMode("log")).toBe("log");
    expect(resolveMode(undefined)).toBe("log");
    expect(resolveMode("")).toBe("log");
    expect(resolveMode("on")).toBe("log");
  });
});

describe("アクセスの判定", () => {
  it("管理者はどのモードでも通す", () => {
    for (const mode of ["log", "enforce"] as const) {
      expect(decideAdminAccess({ mode, signedIn: true, isAdmin: true })).toEqual({
        allow: true,
        wouldDeny: false,
        status: null,
      });
    }
  });

  it("enforce：未ログインは401、権限なしは403で拒否する", () => {
    expect(decideAdminAccess({ mode: "enforce", signedIn: false, isAdmin: false })).toEqual({
      allow: false,
      wouldDeny: true,
      status: 401,
    });
    expect(decideAdminAccess({ mode: "enforce", signedIn: true, isAdmin: false })).toEqual({
      allow: false,
      wouldDeny: true,
      status: 403,
    });
  });

  it("log：拒否はしないが、拒否されるはずのアクセスとして記録できる", () => {
    const d = decideAdminAccess({ mode: "log", signedIn: false, isAdmin: false });
    expect(d.allow).toBe(true);
    expect(d.wouldDeny).toBe(true);
    expect(d.status).toBe(401);
  });
});
