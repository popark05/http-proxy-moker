import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AndroidInterceptionMode,
  AndroidTrafficPath,
  DeviceInfo,
  InterceptionResult
} from '@shared/device';
import {
  INITIAL_LIVENESS,
  stepLiveness,
  type InterceptionLiveness,
  type LivenessTracker
} from '@shared/interception-liveness';

/** 인터셉션이 실제로 시작됐는가. Android는 프록시 설정이 적용돼야 하고, 실패한 시도는 "활성"으로 저장하지 않는다. */
export function interceptionStarted(platform: DeviceInfo['platform'], result: InterceptionResult): boolean {
  return platform === 'android' ? result.proxyConfigured : true;
}

interface UseDevicesResult {
  devices: DeviceInfo[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  interceptions: Record<string, InterceptionResult>;
  start: (
    device: DeviceInfo,
    androidMode?: AndroidInterceptionMode,
    trafficPath?: AndroidTrafficPath
  ) => Promise<InterceptionResult>;
  stop: (device: DeviceInfo) => Promise<void>;
}

interface UseDevicesOptions {
  /** 기기에서 인터셉션이 끊긴 것(예: companion 앱에서 직접 Disconnect)을 알아챘을 때. 이미 활성 목록에서는 제거된 뒤 호출된다. */
  onInterceptionLost?: (device: DeviceInfo) => void;
}

/** 기기 목록 조회 + 인터셉션 시작/해제 상태를 관리하는 훅. */
export function useDevices({ onInterceptionLost }: UseDevicesOptions = {}): UseDevicesResult {
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

  // 주기 확인에서 최신 값을 쓰기 위한 ref(타이머를 다시 만들지 않는다).
  const devicesRef = useRef(devices);
  const interceptionsRef = useRef(interceptions);
  const onLostRef = useRef(onInterceptionLost);
  devicesRef.current = devices;
  interceptionsRef.current = interceptions;
  onLostRef.current = onInterceptionLost;
  const trackers = useRef(new Map<string, LivenessTracker>());
  const checking = useRef(false);

  /** 시작한 Android 인터셉션이 기기에서 아직 살아 있는지 확인하고, 끊겼으면 활성 목록에서 내린다. */
  const checkLiveness = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      for (const [id, result] of Object.entries(interceptionsRef.current)) {
        const device = devicesRef.current.find((d) => d.id === id);
        if (!device || device.platform !== 'android') continue;
        let observed: InterceptionLiveness = 'unknown';
        try {
          observed = await window.mokerApi.device.interceptionStatus('android', id, result.usedMode);
        } catch {
          // 확인 실패는 상태를 바꾸지 않는다.
        }
        const step = stepLiveness(trackers.current.get(id) ?? INITIAL_LIVENESS, observed);
        trackers.current.set(id, step.tracker);
        if (!step.lost) continue;
        trackers.current.delete(id);
        setInterceptions((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        onLostRef.current?.(device);
      }
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 주기적 갱신(기기 연결/해제 반영 + 시작한 인터셉션의 생존 확인).
    const timer = setInterval(() => {
      void refresh();
      void checkLiveness();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, checkLiveness]);

  const start = useCallback(async (
    device: DeviceInfo,
    androidMode?: AndroidInterceptionMode,
    trafficPath?: AndroidTrafficPath
  ) => {
    const result = await window.mokerApi.device.startInterception(
      device.platform,
      device.id,
      androidMode,
      trafficPath
    );
    trackers.current.delete(device.id);
    if (interceptionStarted(device.platform, result)) {
      setInterceptions((prev) => ({ ...prev, [device.id]: result }));
    }
    return result;
  }, []);

  const stop = useCallback(async (device: DeviceInfo) => {
    trackers.current.delete(device.id);
    await window.mokerApi.device.stopInterception(device.platform, device.id);
    setInterceptions((prev) => {
      const next = { ...prev };
      delete next[device.id];
      return next;
    });
  }, []);

  return { devices, refreshing, refresh, interceptions, start, stop };
}
