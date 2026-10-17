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
        <footer>PinePoint demo store. Static data. No real orders or payments.</footer>
      </body>
    </html>
  );
}
