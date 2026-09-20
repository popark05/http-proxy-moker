import { useCallback, useEffect, useState } from 'react';
import type { AndroidInterceptionMode, DeviceInfo, InterceptionResult } from '@shared/device';

interface UseDevicesResult {
  devices: DeviceInfo[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  interceptions: Record<string, InterceptionResult>;
  start: (
    device: DeviceInfo,
    androidMode?: AndroidInterceptionMode
  ) => Promise<InterceptionResult>;
  stop: (device: DeviceInfo) => Promise<void>;
}

/** 기기 목록 조회 + 인터셉션 시작/해제 상태를 관리하는 훅. */
export function useDevices(): UseDevicesResult {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [interceptions, setInterceptions] = useState<Record<string, InterceptionResult>>({});

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await window.mokerApi.device.list();
      setDevices(list);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 주기적 갱신(기기 연결/해제 반영).
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const start = useCallback(async (device: DeviceInfo, androidMode?: AndroidInterceptionMode) => {
    const result = await window.mokerApi.device.startInterception(
      device.platform,
      device.id,
      androidMode
    );
    setInterceptions((prev) => ({ ...prev, [device.id]: result }));
    return result;
  }, []);

  const stop = useCallback(async (device: DeviceInfo) => {
    await window.mokerApi.device.stopInterception(device.platform, device.id);
    setInterceptions((prev) => {
      const next = { ...prev };
      delete next[device.id];
      return next;
    });
  }, []);

  return { devices, refreshing, refresh, interceptions, start, stop };
}
