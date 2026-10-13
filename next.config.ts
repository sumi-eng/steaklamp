import path from "path";
import type { NextConfig } from "next";

// ビルドごとに変わる識別子。画面(ブラウザ)とサーバーの両方に埋め込み、
// 画面を開いたままデプロイされたことを /api/steaklamp/version で検出するのに使う。
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  "local"; // ローカル開発では固定値（再読み込みを起こさない）

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
};

export default nextConfig;
