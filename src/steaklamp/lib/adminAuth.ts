// スタッフ（管理者）の認証。許可するGoogleアカウントは環境変数
// STEAKLAMP_ADMIN_EMAILS（カンマ区切り）で指定する。

import { auth } from "@/auth";
import { isAllowedAdmin } from "@/steaklamp/lib/adminAllowList";

export async function getAdminStatus() {
  const session = await auth();
  const user = session?.user;
  return {
    signedIn: Boolean(user),
    isAdmin: isAllowedAdmin(user, process.env.STEAKLAMP_ADMIN_EMAILS),
  };
}
