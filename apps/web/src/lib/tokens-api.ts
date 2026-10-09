import { api } from "@/lib/api-client";
import { ApiTokenData, NewApiToken } from "@/lib/vault-types";

export const tokensApi = {
  list: () => api.get<ApiTokenData[]>("/tokens"),
  create: (name: string) => api.post<NewApiToken>("/tokens", { name }),
  revoke: (id: number) => api.delete(`/tokens/${id}`),
};
