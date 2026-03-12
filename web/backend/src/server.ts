import { createApp } from "./app.js";
import { config } from "./config.js";

const app = await createApp();

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
