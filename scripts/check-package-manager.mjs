if (!process.env.npm_config_user_agent?.startsWith("pnpm/")) {
  process.stderr.write("Use pnpm to install workspace dependencies.\n");
  process.exit(1);
}
