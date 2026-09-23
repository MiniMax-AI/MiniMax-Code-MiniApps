// @ts-check
// 自驾规划 Mini App Node 入口。
// Host 通过 start(context) 注入 pluginRoot / dataDir / listen / signal / logger。

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { createApplication } from "./app.js";
import { ConfigStore } from "./config-store.js";
import { SwitchableMapProvider } from "./adapters/switchable-map-provider.js";

const MCP_PATH = "/mcp/route-planner";

export async function start(context) {
  await mkdir(context.dataDir, { recursive: true });

  const configStore = new ConfigStore(join(context.dataDir, "config.json"));
  await configStore.load();
  const mapProvider = new SwitchableMapProvider(configStore.snapshot());

  const application = await createApplication({
    databasePath: join(context.dataDir, "trips.sqlite"),
    clientDirectory: join(context.pluginRoot, "miniapp", "client"),
    configStore,
    mapProvider,
    mcpPath: MCP_PATH,
    logger: context.logger
  });

  await application.listen({ host: context.listen.host, port: context.listen.port });
  context.logger?.info?.("miniapp.runtime.listening");

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal?.removeEventListener?.("abort", onAbort);
    try {
      await application.close();
      context.logger?.info?.("miniapp.runtime.disposed");
    } catch (error) {
      context.logger?.warn?.("miniapp.runtime.dispose_failed", {
        message: error?.message ?? String(error)
      });
    }
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal?.addEventListener?.("abort", onAbort, { once: true });
  if (context.signal?.aborted) await dispose();

  return { dispose };
}
