import { ChakraProvider, createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

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
      <ThemeProvider attribute="class" storageKey="velina-color-mode" defaultTheme="system">
        {children}
      </ThemeProvider>
    </ChakraProvider>
  );
}
