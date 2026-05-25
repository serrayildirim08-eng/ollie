/**
 * Central route registry. Modules register their entries here as they ship.
 *
 * Schema is intentionally small: id (stable key), path (URL), label (user-facing),
 * optional icon name (resolved by TabBar to a Phosphor icon component later).
 *
 * Keep this list short until modules actually exist. Do not pre-populate
 * 30 slots — empty slots become design debt.
 */

export interface RouteEntry {
  /** Stable identifier, used as React key + for icon lookup. */
  readonly id: string;
  /** URL path, must start with `/`. */
  readonly path: string;
  /** Short editorial label. Title case, no punctuation. */
  readonly label: string;
  /** Optional icon name. TabBar maps to a Phosphor component. */
  readonly icon?: string;
  /** When true, item is pinned to the primary nav surface (sidebar/tab bar). */
  readonly primary?: boolean;
}

/**
 * Primary nav entries — shown in TabBar.
 *
 * Slot count is deliberately tiny: Home, Modules (a future drawer), Settings.
 * Modules drawer will surface the long tail of 30 module shortcuts later.
 */
export const primaryRoutes: readonly RouteEntry[] = [
  { id: "home", path: "/", label: "Home", icon: "House", primary: true },
  { id: "modules", path: "/modules", label: "Modules", icon: "SquaresFour", primary: true },
  { id: "settings", path: "/settings", label: "Settings", icon: "Gear", primary: true },
] as const;

/**
 * All registered routes (primary + secondary). Other module files will append
 * via a register() helper once we add one — for now this just mirrors primary.
 */
export const routes: readonly RouteEntry[] = primaryRoutes;

export function findRouteById(id: string): RouteEntry | undefined {
  return routes.find((r) => r.id === id);
}
