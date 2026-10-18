import { defineStore } from 'pinia';

/** Socket connection state, shown in the header. */
export const useLiveStore = defineStore('live', {
  state: () => ({ connected: false }),
});
