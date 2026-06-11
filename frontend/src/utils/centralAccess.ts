import type { User } from '@/types/api.types';

export const MULTISITE_DRILL_STATION_KEY = 'multisite_drill_station';
export const MULTISITE_RETURN_TAB_KEY = 'multisite_return_tab';

export function isCentralUser(user?: User | null): boolean {
  return false;
}

export function isCentralDrillDown(user?: User | null): boolean {
  return false;
}
