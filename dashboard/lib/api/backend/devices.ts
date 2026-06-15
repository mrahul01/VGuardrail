import type { Device, DeviceEvent, DeviceInventory } from "@/types";
import type { DeviceDetail, DeviceRepository } from "@/lib/api/types";
import { backendFetch } from "@/lib/api/client";
import { mapPage, backendGetOrNull, type RawPage } from "@/lib/api/backend/_map";

export const createBackendDeviceRepository = (token?: string): DeviceRepository => ({
  list: async (query, filters) =>
    mapPage<Device>(
      await backendFetch<RawPage<Device>>(
        `/admin/devices?${new URLSearchParams({
          page: String(query.page),
          per_page: String(query.perPage),
          ...(query.search ? { search: query.search } : {}),
          ...(query.sortBy ? { sort_by: query.sortBy } : {}),
          ...(query.sortDir ? { sort_dir: query.sortDir } : {}),
          ...(filters?.status ? { status: filters.status } : {}),
          ...(filters?.chainStatus ? { chain_status: filters.chainStatus } : {}),
        }).toString()}`,
        { token },
      ),
    ),
  get: (deviceId) => backendGetOrNull<DeviceDetail>(`/admin/devices/${deviceId}`, token),
  deactivate: async (deviceId) => {
    await backendFetch(`/admin/devices/${deviceId}`, { method: "DELETE", token });
  },
  inventory: async (deviceId) => {
    const inv = await backendFetch<Partial<DeviceInventory>>(
      `/admin/devices/${encodeURIComponent(deviceId)}/inventory`,
      { token },
    );
    return {
      device_id: inv.device_id ?? deviceId,
      collected_at_ms: inv.collected_at_ms ?? 0,
      processes: inv.processes ?? [],
      extensions: inv.extensions ?? [],
    };
  },
  events: async (deviceId, query) =>
    mapPage<DeviceEvent>(
      await backendFetch<RawPage<DeviceEvent>>(
        `/admin/devices/${encodeURIComponent(deviceId)}/events?${new URLSearchParams({
          page: String(query.page),
          per_page: String(query.perPage),
          ...(query.search ? { search: query.search } : {}),
        }).toString()}`,
        { token },
      ),
    ),
});
