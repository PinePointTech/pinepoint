import type { Metadata } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import Link from "next/link";
import { ThemeScript } from "@/components/theme/ThemeScript";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import "./globals.css";

const rounded = M_PLUS_Rounded_1c({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-rounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PinePoint",
  description:
    "Simulated users test each PR preview. PinePoint posts the bug, the steps and the paused browser on the PR.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={rounded.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-fg"
          >
            <span
              aria-hidden
              className="inline-block size-3 rounded-full bg-accent"
            />
            PinePoint
          </Link>
          <ThemeToggle />
        </header>
        {children}
      </body>
    </html>
  );
}
