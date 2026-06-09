import { describe, it, expect } from "vitest";
import { hasAnyRole, OPERATOR_ROLES, ADMIN_ROLES } from "./roles";

describe("hasAnyRole / role tiers", () => {
  it("treats operator, admin, and super_admin as operator-level", () => {
    for (const r of ["operator", "admin", "super_admin"]) {
      expect(hasAnyRole([r], OPERATOR_ROLES)).toBe(true);
    }
  });

  it("only treats admin and super_admin as admin-level", () => {
    expect(hasAnyRole(["admin"], ADMIN_ROLES)).toBe(true);
    expect(hasAnyRole(["super_admin"], ADMIN_ROLES)).toBe(true);
    expect(hasAnyRole(["operator"], ADMIN_ROLES)).toBe(false);
  });

  it("denies roleless or unknown-role users", () => {
    expect(hasAnyRole([], OPERATOR_ROLES)).toBe(false);
    expect(hasAnyRole(["user"], OPERATOR_ROLES)).toBe(false);
    expect(hasAnyRole(["user"], ADMIN_ROLES)).toBe(false);
  });

  it("matches when the user has multiple roles", () => {
    expect(hasAnyRole(["user", "operator"], OPERATOR_ROLES)).toBe(true);
  });
});
