// Pure role constants and decision helper (no runtime deps) so they can be unit
// tested without importing the TanStack middleware runtime.

export const OPERATOR_ROLES = ["super_admin", "admin", "operator"] as const;
export const ADMIN_ROLES = ["super_admin", "admin"] as const;

export function hasAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}
