import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linen and Oat",
  description: "PinePoint demo store.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer>Linen and Oat is a PinePoint demo store. No real orders or payments.</footer>
      </body>
    </html>
  );
}
