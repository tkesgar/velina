export {};

const port = Number(Bun.env.FRONTEND_PORT) || 3012;
const backendUrl = Bun.env.BACKEND_URL || "http://127.0.0.1:3011";
const frontendHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Velina demo frontend</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; color: #202437; background: #f5f6fa; }
      body { display: grid; min-height: 100vh; margin: 0; place-items: center; }
      main { width: min(520px, calc(100% - 40px)); padding: 32px; border: 1px solid #e5e8f0; border-radius: 16px; background: #fff; box-shadow: 0 16px 48px #20243712; }
      h1 { margin-top: 0; letter-spacing: -0.04em; }
      p { color: #687086; line-height: 1.6; }
      button { padding: 10px 16px; border: 0; border-radius: 8px; background: #5965d8; color: white; font: inherit; cursor: pointer; }
      button:disabled { cursor: wait; opacity: .65; }
      pre { min-height: 52px; margin: 20px 0 0; padding: 14px; overflow: auto; border-radius: 8px; background: #f6f7fb; color: #303b80; white-space: pre-wrap; }
      code { overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main>
      <p>VELINA · TWO-APP SMOKE TEST</p>
      <h1>Frontend is running</h1>
      <p>This page calls the backend service at <code>${backendUrl}</code>.</p>
      <button id="hello-button" type="button">Call backend</button>
      <pre id="result" aria-live="polite">Click the button to call apps/backend.</pre>
    </main>
    <script>
      const backendUrl = ${JSON.stringify(backendUrl).replaceAll("<", "\\u003c")};
      const button = document.getElementById("hello-button");
      const result = document.getElementById("result");
      async function callBackend() {
        button.disabled = true;
        result.textContent = "Calling backend…";
        try {
          const response = await fetch(new URL("/api/hello", backendUrl));
          const body = await response.json();
          if (!response.ok) throw new Error(body.message || response.statusText);
          result.textContent = JSON.stringify(body, null, 2);
        } catch (error) {
          result.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          button.disabled = false;
        }
      }
      button.addEventListener("click", callBackend);
      callBackend();
    </script>
  </body>
</html>`;

Bun.serve({
  hostname: "127.0.0.1",
  port,
  routes: {
    "/": new Response(frontendHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Demo frontend is running at http://localhost:${port}`);
