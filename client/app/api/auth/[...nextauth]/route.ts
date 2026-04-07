import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (process.env.NODE_ENV === "production") {
  if (!githubClientId || !githubClientSecret) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in production");
  }
  if (!googleClientId || !googleClientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in production");
  }
}

const { handlers } = NextAuth({
  providers: [
    GitHub({ clientId: githubClientId ?? "", clientSecret: githubClientSecret ?? "" }),
    Google({ clientId: googleClientId ?? "", clientSecret: googleClientSecret ?? "" }),
  ],
  pages: { signIn: "/auth/signin" },
});

export const { GET, POST } = handlers;
