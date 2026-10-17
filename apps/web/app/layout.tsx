import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PinePoint",
  description:
    "Simulated users test each PR preview. PinePoint posts the bug, the steps and the paused browser on the PR.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
