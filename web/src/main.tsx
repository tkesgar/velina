import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

import { createRoot } from "react-dom/client";

import { App } from "./app";
import { Provider } from "./theme";

// No StrictMode: Cap'n Web stubs are callable, so StrictMode's double-mounted
// effects would open two RPC sessions and register duplicate broken handlers.
createRoot(document.getElementById("root")!).render(
  <Provider>
    <App />
  </Provider>,
);
