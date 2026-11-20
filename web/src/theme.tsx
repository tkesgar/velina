import { ChakraProvider, createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { ColorModeProvider } from "./lib/color-mode";

const config = defineConfig({
  theme: {
    tokens: {
      fonts: {
        heading: { value: "'Geist Variable', sans-serif" },
        body: { value: "'Geist Variable', sans-serif" },
        mono: { value: "'Geist Mono Variable', monospace" },
      },
    },
  },
});

const system = createSystem(defaultConfig, config);

export function Provider({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider>{children}</ColorModeProvider>
    </ChakraProvider>
  );
}
