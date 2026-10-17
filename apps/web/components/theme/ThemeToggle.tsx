"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Storage can be blocked. The theme still changes for this page.
    }
  }

  const label = dark ? "Use light mode" : "Use dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:text-fg"
    >
      {dark ? (
        <Sun className="size-4" strokeWidth={1.75} aria-hidden />
      ) : (
        <Moon className="size-4" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}
