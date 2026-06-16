import type { BetOffApi } from "./index";

declare global {
  interface Window {
    betoff: BetOffApi;
  }
}
export {};
