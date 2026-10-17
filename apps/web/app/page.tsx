import Link from "next/link";

// Placeholder landing page. VI-19 builds the real one.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-4xl font-semibold text-pine-900">PinePoint</h1>
      <p className="text-lg">
        Simulated users test each PR preview. PinePoint posts the bug, the
        steps and the paused browser on the PR.
      </p>
      <Link
        href="/app"
        className="w-fit rounded-full bg-pine-600 px-5 py-2 font-medium text-white"
      >
        Open the app
      </Link>
    </main>
  );
}
