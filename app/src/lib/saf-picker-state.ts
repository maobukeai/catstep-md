/** Shared by launch, resume and cancellation; keep the legacy key readable. */
export const SAF_PICKING_KEY = 'catstep:saf-picking';
const LEGACY_KEY = 'solomd:saf-picking';

export function setSafPicking(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(SAF_PICKING_KEY, '1');
}

export function isSafPicking(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(SAF_PICKING_KEY) === '1' || storage.getItem(LEGACY_KEY) === '1';
}

export function clearSafPicking(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(SAF_PICKING_KEY);
  storage.removeItem(LEGACY_KEY);
}
