import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ColorMode = "light" | "dark";

const STORAGE_KEY = "velina-color-mode";

interface ColorModeContextValue {
  colorMode: ColorMode;
  toggleColorMode: () => void;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

function systemColorMode(): ColorMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedColorMode(): ColorMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyColorMode(mode: ColorMode): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(mode);
  root.style.colorScheme = mode;
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [colorMode, setColorMode] = useState<ColorMode>(
    () => storedColorMode() ?? systemColorMode(),
  );

  useEffect(() => {
    applyColorMode(colorMode);
  }, [colorMode]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!storedColorMode()) setColorMode(systemColorMode());
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggleColorMode = useCallback(() => {
    setColorMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage may be unavailable; the in-memory mode still applies.
      }
      return next;
    });
  }, []);

  return (
    <ColorModeContext.Provider value={{ colorMode, toggleColorMode }}>
      {children}
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): ColorModeContextValue {
  const value = useContext(ColorModeContext);
  if (!value) {
    throw new Error("useColorMode must be used within a ColorModeProvider");
  }

  return value;
}
