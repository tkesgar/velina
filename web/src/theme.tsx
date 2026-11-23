import { ChakraProvider, createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { ColorModeProvider } from "./lib/color-mode";

// colors and palettes are generated from:
// https://palette.saas-ui.dev/?color=0063eb

const colors = {
  brand: {
    50: { value: "oklch(0.97 0.026 259.942)" },
    100: { value: "oklch(0.94 0.048 259.942)" },
    200: { value: "oklch(0.89 0.088 259.942)" },
    300: { value: "oklch(0.81 0.136 259.942)" },
    400: { value: "oklch(0.71 0.187 259.942)" },
    500: { value: "oklch(0.62 0.22 259.942)" },
    600: { value: "oklch(0.54 0.22 259.942)" },
    700: { value: "oklch(0.45 0.18 259.942)" },
    800: { value: "oklch(0.36 0.136 259.942)" },
    900: { value: "oklch(0.27 0.092 259.942)" },
    950: { value: "oklch(0.2 0.062 259.942)" },
  },
  gray: {
    50: { value: "oklch(0.97 0.003 260)" },
    100: { value: "oklch(0.94 0.005 260)" },
    200: { value: "oklch(0.89 0.007 260)" },
    300: { value: "oklch(0.81 0.008 260)" },
    400: { value: "oklch(0.71 0.01 260)" },
    500: { value: "oklch(0.62 0.012 260)" },
    600: { value: "oklch(0.54 0.012 260)" },
    700: { value: "oklch(0.45 0.011 260)" },
    800: { value: "oklch(0.36 0.009 260)" },
    900: { value: "oklch(0.27 0.008 260)" },
    950: { value: "oklch(0.2 0.007 260)" },
  },
};

const palettes = {
  brand: {
    contrast: {
      value: {
        _light: "oklch(0.985 0.013 259.942)",
        _dark: "oklch(0.985 0.013 259.942)",
      },
    },
    fg: {
      value: {
        _light: "oklch(0.44 0.143 259.942)",
        _dark: "oklch(0.78 0.143 259.942)",
      },
    },
    muted: {
      value: {
        _light: "oklch(0.541 0.22 259.942 / 0.07)",
        _dark: "oklch(0.541 0.22 259.942 / 0.1)",
      },
    },
    subtle: {
      value: {
        _light: "oklch(0.541 0.22 259.942 / 0.11)",
        _dark: "oklch(0.541 0.22 259.942 / 0.16)",
      },
    },
    emphasized: {
      value: {
        _light: "oklch(0.541 0.22 259.942 / 0.18)",
        _dark: "oklch(0.541 0.22 259.942 / 0.24)",
      },
    },
    solid: {
      value: {
        _light: "oklch(0.541 0.22 259.942)",
        _dark: "oklch(0.541 0.22 259.942)",
      },
    },
    focusRing: {
      value: {
        _light: "oklch(0.541 0.22 259.942)",
        _dark: "oklch(0.541 0.22 259.942)",
      },
    },
    border: {
      value: {
        _light: "oklch(0.541 0.22 259.942 / 0.32)",
        _dark: "oklch(0.541 0.22 259.942 / 0.44)",
      },
    },
  },
  gray: {
    contrast: {
      value: {
        _light: "oklch(0.985 0.001 260)",
        _dark: "oklch(0.985 0.001 260)",
      },
    },
    fg: {
      value: {
        _light: "oklch(0.44 0.008 260)",
        _dark: "oklch(0.78 0.008 260)",
      },
    },
    muted: {
      value: {
        _light: "oklch(0.45 0.012 260 / 0.07)",
        _dark: "oklch(0.45 0.012 260 / 0.1)",
      },
    },
    subtle: {
      value: {
        _light: "oklch(0.45 0.012 260 / 0.11)",
        _dark: "oklch(0.45 0.012 260 / 0.16)",
      },
    },
    emphasized: {
      value: {
        _light: "oklch(0.45 0.012 260 / 0.18)",
        _dark: "oklch(0.45 0.012 260 / 0.24)",
      },
    },
    solid: {
      value: {
        _light: "oklch(0.45 0.012 260)",
        _dark: "oklch(0.45 0.012 260)",
      },
    },
    focusRing: {
      value: {
        _light: "oklch(0.45 0.012 260)",
        _dark: "oklch(0.45 0.012 260)",
      },
    },
    border: {
      value: {
        _light: "oklch(0.45 0.012 260 / 0.32)",
        _dark: "oklch(0.45 0.012 260 / 0.44)",
      },
    },
  },
};

const config = defineConfig({
  theme: {
    tokens: {
      fonts: {
        heading: { value: "'Geist Variable', sans-serif" },
        body: { value: "'Geist Variable', sans-serif" },
        mono: { value: "'Geist Mono Variable', monospace" },
      },
      colors,
    },
    semanticTokens: { colors: palettes },
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
