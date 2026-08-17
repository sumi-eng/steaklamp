import NextAuth from "next-auth";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";
import LINE from "next-auth/providers/line";

// Yahoo! JAPAN には next-auth 組み込みプロバイダーがないため OIDC を手書きで定義する。
// userinfo エンドポイントは審査未承認のため使えず、IDトークンのclaimsから情報を取得する。
const YahooJapan = {
  id: "yahoojp",
  name: "Yahoo! JAPAN",
  type: "oidc" as const,
  issuer: "https://auth.login.yahoo.co.jp/yconnect/v2",
  wellKnown: "https://auth.login.yahoo.co.jp/yconnect/v2/.well-known/openid-configuration",
  clientId: process.env.YAHOOJP_CLIENT_ID,
  clientSecret: process.env.YAHOOJP_CLIENT_SECRET,
  authorization: {
    params: {
      scope: "openid profile email",
      response_type: "code",
    },
  },
  client: {
    token_endpoint_auth_method: "client_secret_basic",
  },
  idToken: true,
  checks: ["state"] as ("state")[],
  profile(profile: Record<string, any>) {
    return {
      id: String(profile.sub),
      name: profile.name ?? profile.nickname ?? null,
      email: profile.email ?? null,
      image: profile.picture ?? null,
    };
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    LINE({
      clientId: process.env.LINE_CLIENT_ID,
      clientSecret: process.env.LINE_CLIENT_SECRET,
    }),
    Facebook({
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    }),
    YahooJapan,
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.provider = account.provider;
        token.providerAccountId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.provider = token.provider as string | undefined;
        session.user.providerAccountId = token.providerAccountId as
          | string
          | undefined;
      }
      return session;
    },
  },
});
