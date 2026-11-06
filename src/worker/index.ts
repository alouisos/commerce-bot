async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file; rely on the process environment
  }
  // Imported after the env file is loaded: db/client reads the environment at import time.
  const { getBoss } = await import("@/lib/jobs");
  const { handlers, registerHandlers } = await import("./handlers");
  const boss = await getBoss();
  await registerHandlers(boss, handlers);
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
