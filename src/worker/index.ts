async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file; rely on the process environment
  }
  // Imported after the env file is loaded, so the first env read (on first use) sees it.
  const { getBoss, JOBS } = await import("@/lib/jobs");
  const { handlers, registerHandlers } = await import("./handlers");
  const boss = await getBoss();
  await registerHandlers(boss, handlers);
  // Queues exist already (getBoss creates them); schedule() upserts, so this is safe on every start.
  await boss.schedule(JOBS.weeklyRecrawl, "0 3 * * 1");
  await boss.schedule(JOBS.dailyInsights, "0 4 * * *");
  await boss.schedule(JOBS.emailTick, "*/15 * * * *");
  await boss.schedule(JOBS.retention, "30 3 * * *");
  console.log("[worker] started");
  const stop = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
