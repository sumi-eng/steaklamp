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
