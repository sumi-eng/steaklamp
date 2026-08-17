import NextAuth from "next-auth";
import type { OAuthConfig } from "next-auth/providers";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";
import LINE from "next-auth/providers/line";

interface YahooJapanProfile {
  sub?: string;
  user_id?: string;
  name?: string;
  nickname?: string;
  email?: string;
  picture?: string;
}

// Yahoo! JAPAN には next-auth 組み込みプロバイダーがないため OIDC を手書きで定義する。
// authorization/token/userinfo を明示するので discovery (.well-known) には依存しない。
function YahooJapan(): OAuthConfig<YahooJapanProfile> {
  return {
    id: "yahoojp",
    name: "Yahoo! JAPAN",
    type: "oidc",
    issuer: "https://auth.login.yahoo.co.jp/yconnect/v2",
    clientId: process.env.YAHOOJP_CLIENT_ID,
    clientSecret: process.env.YAHOOJP_CLIENT_SECRET,
    authorization: {
      url: "https://auth.login.yahoo.co.jp/yconnect/v2/authorization",
      params: { scope: "openid profile email", response_type: "code" },
    },
    token: "https://auth.login.yahoo.co.jp/yconnect/v2/token",
    userinfo: "https://userinfo.yahooapis.jp/yconnect/v2/attribute",
    checks: ["state"],
    idToken: false,
    profile(profile) {
      return {
        id: profile.sub ?? profile.user_id ?? "",
        name: profile.name ?? profile.nickname ?? null,
        email: profile.email ?? null,
        image: profile.picture ?? null,
      };
    },
  };
}

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
    YahooJapan(),
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
