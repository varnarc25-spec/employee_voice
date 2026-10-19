import { createApp } from "./app.js";
import { assertProductionConfig, config } from "./config.js";
import { migrate } from "./db.js";
import { seedDevelopment } from "./seed.js";

assertProductionConfig();
if (config.migrateOnStart) await migrate();
if (config.seedDemo) await seedDevelopment();

createApp().listen(config.port, "0.0.0.0", () => {
  console.info("Employee Voice India API listening on port %s", config.port);
});
