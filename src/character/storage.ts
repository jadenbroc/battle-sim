import type { Character } from './characterTypes';
import { MAX_PARTY, parseCharacterJson } from './edit';

/** The part of localStorage the app uses, so tests can pass a stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PARTY_KEY = 'battle-sim.party.v1';

/** The browser's storage, or undefined where it is blocked or missing (private windows, tests). */
export function browserStore(): KeyValueStore | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Load the saved party. Anything unreadable is dropped rather than breaking the app. */
export function loadParty(store: KeyValueStore | undefined = browserStore()): Character[] {
  try {
    const text = store?.getItem(PARTY_KEY);
    return text ? parseCharacterJson(text, { lenient: true }).characters.slice(0, MAX_PARTY) : [];
  } catch {
    return [];
  }
}

/** Save the party in the browser only: nothing is sent anywhere. Returns false if storage is unavailable. */
export function saveParty(characters: readonly Character[], store: KeyValueStore | undefined = browserStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(PARTY_KEY, JSON.stringify(characters));
    return true;
  } catch {
    return false;
  }
}
