import type { MokerApi } from '@shared/ipc';

declare global {
  interface Window {
    mokerApi: MokerApi;
  }
}

export {};
