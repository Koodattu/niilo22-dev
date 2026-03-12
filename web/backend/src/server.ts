import { createApp } from "./app.js";
import { config } from "./config.js";
import { ensureSchema } from "./lib/ensure-schema.js";

const app = await createApp();

try {
  app.log.info("Ensuring database schema");
  await ensureSchema();

  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
