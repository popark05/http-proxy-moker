/**
 * USB ADB 기기 탐색. `usb` 패키지는 네이티브 바이너리(@node-usb/usb-<platform>)를 쓰므로 지연 로드한다:
 * 로드에 실패해도(해당 아키텍처 바이너리 없음 등) 앱/테스트가 import 시점에 죽지 않고 USB만 비활성화된다.
 */

import { findAdbInterface, safe, type UsbDeviceLike } from './usb';

/** 기기 목록을 주는 USB 백엔드(`usb` 패키지의 usb 객체가 만족). 테스트는 가짜로 대체. */
export interface UsbBackend {
  getDevices(): Promise<UsbDeviceLike[]>;
}

export interface UsbAdbDeviceInfo {
  /** USB 시리얼(adb devices의 serial과 같음). 없으면 버스 위치 기반 식별자. */
  serial: string;
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  device: UsbDeviceLike;
}

let defaultBackend: Promise<UsbBackend> | undefined;

/** `usb` 패키지를 불러온다(한 번만). 실패하면 원인과 함께 reject. */
export function loadUsbBackend(): Promise<UsbBackend> {
  if (!defaultBackend) {
    defaultBackend = import('usb').then((mod) => mod.usb as unknown as UsbBackend);
    defaultBackend.catch(() => {
      defaultBackend = undefined; // 다음 호출에서 다시 시도
    });
  }
  return defaultBackend;
}

/** 연결된 USB 기기 중 ADB 인터페이스가 있는 것(인증 전 unauthorized 기기 포함). */
export async function listUsbAdbDevices(backend?: UsbBackend): Promise<UsbAdbDeviceInfo[]> {
  const usb = backend ?? (await loadUsbBackend());
  const devices = await usb.getDevices();
  const result: UsbAdbDeviceInfo[] = [];
  for (const device of devices) {
    // 허브/키보드 등은 열 수 없거나 ADB 인터페이스가 없다 → findAdbInterface가 undefined.
    if (!findAdbInterface(device)) continue;
    result.push({
      serial: usbSerial(device),
      vendorId: device.vendorId,
      productId: device.productId,
      productName: safe(() => device.productName),
      manufacturerName: safe(() => device.manufacturerName),
      device
    });
  }
  return result;
}

/** 시리얼로 ADB 기기를 찾는다(재연결 시 새 USBDevice 객체를 얻기 위해). */
export async function findUsbAdbDevice(serial: string, backend?: UsbBackend): Promise<UsbDeviceLike | undefined> {
  return (await listUsbAdbDevices(backend)).find((d) => d.serial === serial)?.device;
}

export function usbSerial(device: UsbDeviceLike): string {
  const serial = safe(() => device.serialNumber);
  if (serial) return serial;
  const location = device as { bus?: string; address?: number };
  return `usb:${location.bus ?? '?'}-${location.address ?? '?'}`;
}
