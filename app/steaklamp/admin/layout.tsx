import type { Metadata } from "next";
import AdminLoginScreen from "@/components/steaklamp/AdminLoginScreen";
import AdminSessionBar from "@/components/steaklamp/AdminSessionBar";
import { getAdminAuthMode, getAdminStatus } from "@/steaklamp/lib/adminAuth";

export const metadata: Metadata = {
  title: "Lamp 管理画面",
  robots: { index: false, follow: false },
};

// 管理画面は毎回ログイン状態を確認する
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const status = await getAdminStatus();
  const mode = getAdminAuthMode();

  // enforce のときは、管理者でなければ画面の中身を描画しない（データも読み込まれない）。
  // log のときは従来どおり表示する（切り替え前の確認期間）。
  if (mode === "enforce" && !status.isAdmin) {
    return <AdminLoginScreen signedIn={status.signedIn} email={status.email} />;
  }

  return (
    <>
      <AdminSessionBar email={status.email} />
      {children}
    </>
  );
}
