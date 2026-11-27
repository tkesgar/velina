import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

import type { VelinaApi } from "#/lib/api";

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
  const session = useRef<RpcStub<VelinaApi> | null>(null);
  const [connected, setConnected] = useState(true);

  const reconnect = useCallback(() => {
    setConnected(false);
    session.current = openSession(reconnect);
    // A stub is callable, so React would treat a bare stub as a state updater.
    setApi(() => session.current!);
    setConnected(true);
  }, []);

  // StrictMode invokes state initializers twice and discards one result, which
  // would leave an extra session and broken handler behind. A ref survives the
  // double render, so creation stays a one-time operation.
  if (session.current === null) {
    session.current = openSession(reconnect);
  }
  const [api, setApi] = useState(() => session.current!);

  return <VelinaContext.Provider value={{ api, connected }}>{children}</VelinaContext.Provider>;
}

export function useVelina(): VelinaContextValue {
  const value = useContext(VelinaContext);
  if (!value) {
    throw new Error("useVelina must be used within a VelinaProvider");
  }

  return value;
}
