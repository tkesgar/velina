import { useCallback, useEffect, useState } from "react";

import {
  isYamlConfig,
  type LogEntry,
  type LogType,
  type ProcessInfo,
  type YamlConfig,
} from "../../../lib/api";
import type { LoadedConfig } from "../../../lib/config";
import { useVelina } from "./velina-context";

const MAX_DISPLAYED_LINES = 1000;
const POLL_INTERVAL_MS = 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useConfig() {
  const { api } = useVelina();
  const [config, setConfig] = useState<LoadedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void Promise.resolve(api.getConfig()).then(
      (value) => {
        if (!active) return;
        if (isYamlConfig(value)) {
          setError("Unexpected config format");
          return;
        }

        setConfig(value);
        setError(null);
      },
      (cause: unknown) => {
        if (active) setError(errorMessage(cause));
      },
    );

    return () => {
      active = false;
    };
  }, [api]);

  return { config, error };
}

export function useYamlConfig() {
  const { api } = useVelina();
  const [config, setConfig] = useState<YamlConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void Promise.resolve(api.getConfig({ format: "yaml" })).then(
      (value) => {
        if (!active) return;
        if (!isYamlConfig(value)) {
          setError("Unexpected config format");
          return;
        }

        setConfig(value);
        setError(null);
      },
      (cause: unknown) => {
        if (active) setError(errorMessage(cause));
      },
    );

    return () => {
      active = false;
    };
  }, [api]);

  return { config, error };
}

export function useProcesses() {
  const { api } = useVelina();
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await Promise.resolve(api.getAllProcesses());
      setProcesses(next);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { processes, refresh, error };
}

export function useProcessLogs(id: string | null, type: LogType) {
  const { api } = useVelina();
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLines([]);
    setError(null);
    if (!id) return;

    let cancelled = false;
    let reader: ReadableStreamDefaultReader<LogEntry> | undefined;

    void (async () => {
      try {
        const stream = await Promise.resolve(api.streamProcessLogs(id, type));
        if (cancelled) {
          // StrictMode's simulated unmount can cancel before the stream arrives.
          void stream.cancel().catch(() => {});
          return;
        }

        reader = stream.getReader();
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done || cancelled) break;
          setLines((previous) => [...previous, value].slice(-MAX_DISPLAYED_LINES));
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    })();

    return () => {
      cancelled = true;
      if (reader) void reader.cancel().catch(() => {});
    };
  }, [api, id, type]);

  return { lines, error };
}
