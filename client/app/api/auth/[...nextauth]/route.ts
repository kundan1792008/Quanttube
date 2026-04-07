import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

const providers: Provider[] = [];

if (githubClientId && githubClientSecret) {
  providers.push(GitHub({ clientId: githubClientId, clientSecret: githubClientSecret }));
}

if (googleClientId && googleClientSecret) {
  providers.push(Google({ clientId: googleClientId, clientSecret: googleClientSecret }));
}

if (providers.length === 0 && process.env.NODE_ENV !== "development") {
  console.warn("NextAuth is running without configured OAuth providers.");
}

const { handlers } = NextAuth({
  providers,
});

export const { GET, POST } = handlers;
