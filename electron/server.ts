import http, { type Server } from "node:http";
import next from "next";

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export async function startNextServer(appDir: string): Promise<ServerHandle> {
  const app = next({
    dev: false,
    dir: appDir,
    customServer: true,
    hostname: "127.0.0.1",
  });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server: Server = http.createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Next.js server did not bind to a TCP address");
  }

  return {
    port: addr.port,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
