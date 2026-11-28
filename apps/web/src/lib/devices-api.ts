import { api } from "@/lib/api-client";
import { DeviceTokenData, NewDeviceToken } from "@/lib/vault-types";

/** Device tokens (nyd_...) for capture clients. Only a signed-in session may call these. */
export const devicesApi = {
  list: () => api.get<DeviceTokenData[]>("/devices/tokens"),
  create: (name: string) => api.post<NewDeviceToken>("/devices/tokens", { name }),
  revoke: (id: number) => api.delete(`/devices/tokens/${id}`),
};
