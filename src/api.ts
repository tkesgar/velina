import { newHttpBatchRpcSession, type RpcTarget } from "capnweb";

interface VelinaApi extends RpcTarget {
  hello(name?: string): string;
}

export function hello(name?: string) {
  const api = newHttpBatchRpcSession<VelinaApi>("/api");
  return api.hello(name);
}
