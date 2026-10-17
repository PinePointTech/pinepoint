import {
  GitPullRequestArrow,
  MonitorPause,
  MousePointerClick,
  RotateCw,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";

type Step = { name: string; icon: LucideIcon; text: string };

const steps: Step[] = [
  {
    name: "Find",
    icon: ScanSearch,
    text: "The planner reads the diff and qa.md and writes 10 missions. Pine computers run them on the preview at the same time.",
  },
  {
    name: "Show",
    icon: MonitorPause,
    text: "A failed computer stays paused at the broken state. PinePoint posts a PR comment with the screenshot, the steps and the session link.",
  },
  {
    name: "Decide",
    icon: MousePointerClick,
    text: "You open the session and take control. Then you click Bug or Not a bug.",
  },
  {
    name: "Fix",
    icon: GitPullRequestArrow,
    text: "For a bug, the fix agent proposes one fix as a GitHub suggestion.",
  },
  {
    name: "Prove",
    icon: RotateCw,
    text: "After you commit the fix, Re-run runs the failed mission on the new preview.",
  },
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works"
      className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6"
    >
      <h2
        id="how-it-works"
        className="text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        How it works
      </h2>
      <ol className="relative mt-10 grid gap-8 md:grid-cols-5 md:gap-6">
        <span
          aria-hidden
          className="absolute left-5 top-5 bottom-5 w-px bg-border md:left-5 md:right-[15%] md:top-5 md:bottom-auto md:h-px md:w-auto"
        />
        {steps.map(({ name, icon: Icon, text }) => (
          <li key={name} className="pp-reveal relative flex gap-4 md:flex-col md:gap-4">
            <span className="relative z-10 inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-accent">
              <Icon className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div>
              <h3 className="text-lg font-bold">{name}</h3>
              <p className="mt-1 max-w-[34ch] text-[15px] leading-relaxed text-muted">
                {text}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
