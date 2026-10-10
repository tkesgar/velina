export {};

const port = Number(Bun.env.BACKEND_PORT) || 3011;

Bun.serve({
  hostname: "127.0.0.1",
  port,
  routes: {
    "/api/hello": () =>
      Response.json(
        {
          message: "Hello from apps/backend!",
          timestamp: new Date().toISOString(),
        },
        { headers: { "Access-Control-Allow-Origin": "*" } },
      ),
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Demo backend is running at http://localhost:${port}`);
