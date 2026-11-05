// 管理者の許可リスト判定（純粋関数。テストできるよう auth への依存を持たせない）

type SessionUser = {
  email?: string | null;
  provider?: string | null;
} | null | undefined;

export function parseAdminEmails(value: string | undefined | null) {
  return String(value ?? "")
    .split(/[,\s;]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

// サイトのSNSログインはお客様も使うため、「ログイン済み」だけでは管理者と見なさない。
// Googleでログインし、そのメールが許可リストに載っている場合だけ管理者とする。
// 他のSNSはメールの出所が保証できないため認めない。リスト未設定のときは全員拒否。
export function isAllowedAdmin(user: SessionUser, allowListValue: string | undefined | null) {
  if (!user) return false;
  if (user.provider !== "google") return false;
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return false;
  return parseAdminEmails(allowListValue).includes(email);
}

// ---- 切り替えモード ----
// log     : 判定してログに残すが、拒否はしない（導入初期の確認用。既定）
// enforce : 実際に拒否する
export type EnforceMode = "log" | "enforce";

export function resolveMode(value: string | undefined | null): EnforceMode {
  return String(value ?? "").trim().toLowerCase() === "enforce" ? "enforce" : "log";
}

export type AdminAccessDecision = {
  // 処理を続けてよいか
  allow: boolean;
  // enforce なら拒否されるはずのアクセスか（log モードでの確認ログ用）
  wouldDeny: boolean;
  status: 401 | 403 | null;
};

export function decideAdminAccess(args: {
  mode: EnforceMode;
  signedIn: boolean;
  isAdmin: boolean;
}): AdminAccessDecision {
  if (args.isAdmin) return { allow: true, wouldDeny: false, status: null };
  const status = args.signedIn ? 403 : 401;
  return { allow: args.mode !== "enforce", wouldDeny: true, status };
}
