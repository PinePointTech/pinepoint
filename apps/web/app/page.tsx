import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { PrCommentCard } from "@/components/landing/PrCommentCard";

export default function Home() {
  return (
    <main>
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-10 pb-16 sm:px-6 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div>
          <h1 className="text-balance text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Every preview gets a QA team
          </h1>
          <p className="mt-5 max-w-[46ch] text-pretty text-lg leading-relaxed text-muted">
            You review the code. PinePoint uses the preview like a real user
            and shows you where it breaks.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/app"
              className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-bold text-accent-fg shadow-[0_8px_20px_-10px_rgb(47_122_82/0.6)] transition-colors hover:bg-accent-hover"
            >
              Open the app
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2}
                aria-hidden
              />
            </Link>
            <a
              href="https://github.com/vihuynh72/pinepoint/pull/10"
              className="font-bold text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
            >
              See a demo PR
            </a>
          </div>
        </div>
        <PrCommentCard />
      </section>
      <HowItWorks />
    </main>
  );
}
