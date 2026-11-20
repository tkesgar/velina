import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import type { VelinaApi } from "../../../lib/api";

interface VelinaContextValue {
  api: RpcStub<VelinaApi>;
  connected: boolean;
}

const VelinaContext = createContext<VelinaContextValue | null>(null);

function openSession(onBroken: () => void): RpcStub<VelinaApi> {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const api = newWebSocketRpcSession<VelinaApi>(`${protocol}//${window.location.host}/api`);
  api.onRpcBroken(onBroken);
  return api;
}

export function VelinaProvider({ children }: { children: ReactNode }) {
  const reconnect = useCallback(() => {
    setConnected(false);
    // A stub is callable, so React would treat a bare stub as a state updater.
    setApi(() => openSession(reconnect));
    setConnected(true);
  }, []);

  const [api, setApi] = useState(() => openSession(reconnect));
  const [connected, setConnected] = useState(true);

  return <VelinaContext.Provider value={{ api, connected }}>{children}</VelinaContext.Provider>;
}

export function useVelina(): VelinaContextValue {
  const value = useContext(VelinaContext);
  if (!value) {
    throw new Error("useVelina must be used within a VelinaProvider");
  }

  return value;
}
