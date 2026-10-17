import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PinePoint demo store",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
