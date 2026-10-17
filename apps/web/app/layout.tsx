import type { Metadata } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import { MapPin } from "lucide-react";
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
  title: "PinePoint: every preview gets a QA team",
  description:
    "You review the code. PinePoint uses the preview like a real user and shows you where it breaks.",
  icons: { icon: "/icon.svg" },
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
            className="flex items-center gap-1.5 text-lg font-extrabold tracking-tight text-fg"
          >
            <MapPin
              className="size-5 text-accent"
              strokeWidth={2}
              aria-hidden
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
