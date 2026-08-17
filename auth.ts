import NextAuth from "next-auth";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";
import LINE from "next-auth/providers/line";

// Yahoo! JAPAN には next-auth 組み込みプロバイダーがないため OAuth を手書きで定義する。
// authorization/token/userinfo を明示するので discovery (.well-known) には依存しない。
const YahooJapan = {
  id: "yahoojp",
  name: "Yahoo! JAPAN",
  type: "oauth" as const,
  authorization: {
    url: "https://auth.login.yahoo.co.jp/yconnect/v2/authorization",
    params: {
      scope: "openid profile email",
      response_type: "code",
    },
  },
  token: "https://auth.login.yahoo.co.jp/yconnect/v2/token",
  userinfo: "https://userinfo.yahooapis.jp/yconnect/v2/attribute",
  clientId: process.env.YAHOOJP_CLIENT_ID,
  clientSecret: process.env.YAHOOJP_CLIENT_SECRET,
  client: {
    token_endpoint_auth_method: "client_secret_basic",
  },
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
