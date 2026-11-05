// スタッフ（管理者）の認証。許可するGoogleアカウントは環境変数
// STEAKLAMP_ADMIN_EMAILS（カンマ区切り）で指定する。
// ADMIN_AUTH_MODE=enforce で実際に拒否する。未設定・log のときは判定結果をログに残すだけ。

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  decideAdminAccess,
  isAllowedAdmin,
  resolveMode,
} from "@/steaklamp/lib/adminAllowList";

export function getAdminAuthMode() {
  return resolveMode(process.env.ADMIN_AUTH_MODE);
}

export async function getAdminStatus() {
  const session = await auth();
  const user = session?.user;
  return {
    signedIn: Boolean(user),
    isAdmin: isAllowedAdmin(user, process.env.STEAKLAMP_ADMIN_EMAILS),
    email: user?.email ?? null,
  };
}

// 管理用APIの先頭で呼ぶ。拒否すべきときは401/403のレスポンスを返す（呼び出し側はそのまま return する）。
// log モードでは拒否せず、「enforce なら拒否される」アクセスだけをログに残す。
export async function requireAdmin(
  label: string,
  options: { unusedCandidate?: boolean } = {}
): Promise<NextResponse | null> {
  const mode = getAdminAuthMode();
  const status = await getAdminStatus();

  // 使われていない可能性のあるAPIは、呼ばれたこと自体を記録する（削除の判断材料）
  if (options.unusedCandidate) {
    console.warn(
      `STEAKLAMP_UNUSED_ROUTE_CALLED route=${label} signedIn=${status.signedIn} admin=${status.isAdmin}`
    );
  }

  const decision = decideAdminAccess({
    mode,
    signedIn: status.signedIn,
    isAdmin: status.isAdmin,
  });

  if (decision.wouldDeny) {
    console.warn(
      `STEAKLAMP_ADMIN_AUTH_${decision.allow ? "WOULD_DENY" : "DENIED"} route=${label} mode=${mode} signedIn=${status.signedIn} email=${status.email ?? "-"}`
    );
  }

  if (decision.allow) return null;

  return NextResponse.json(
    {
      ok: false,
      error: decision.status === 401 ? "login_required" : "forbidden",
    },
    { status: decision.status ?? 401 }
  );
}
