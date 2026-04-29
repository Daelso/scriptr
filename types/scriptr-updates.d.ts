import type { UpdateState } from "@/lib/update-state";

declare global {
  interface Window {
    scriptrUpdates?: {
      checkNow(): Promise<UpdateState>;
      installNow(): Promise<void>;
      getState(): Promise<UpdateState>;
      getLogPath(): Promise<string>;
    };
  }
}

export {};
