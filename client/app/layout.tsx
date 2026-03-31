import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quanttube – Format-Shifting Engine",
  description: "YouTube + OTT + Spotify hybrid media player",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
