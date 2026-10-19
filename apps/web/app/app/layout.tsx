import Link from "next/link";
import { PinePointMark } from "@/components/brand/PinePointMark";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-lg font-extrabold tracking-tight text-fg"
        >
          <PinePointMark size={24} className="shrink-0 text-accent" />
          PinePoint
        </Link>
        <ThemeToggle />
      </header>
      {children}
    </>
  );
}
