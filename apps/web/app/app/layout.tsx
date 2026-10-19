import { MapPin } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-lg font-extrabold tracking-tight text-fg"
        >
          <MapPin className="size-5 text-accent" strokeWidth={2} aria-hidden />
          PinePoint
        </Link>
        <ThemeToggle />
      </header>
      {children}
    </>
  );
}
