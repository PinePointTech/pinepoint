// Deploy check. Shows which deployment answers and which env vars are set.
// It returns names and true or false only. It never returns a value.
export const dynamic = "force-dynamic";

const ENV_KEYS = [
  "PINE_SANDBOX_API_KEY",
  "PINE_SANDBOX_ENDPOINT",
  "ANTHROPIC_API_KEY",
  "PLANNER_MODEL",
  "FIX_MODEL",
  "GITHUB_TOKEN",
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "ENCRYPTION_KEY",
  "APP_BASE_URL",
  "DEMO_PRODUCTION_URL",
  "VERCEL_DEMO_PROJECT_NAME",
] as const;

export function GET() {
  const env = Object.fromEntries(
    ENV_KEYS.map((key) => [key, Boolean(process.env[key])]),
  );
  return Response.json({
    ok: true,
    service: "pinepoint-web",
    vercelEnv: process.env.VERCEL_ENV ?? "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    env,
  });
}
