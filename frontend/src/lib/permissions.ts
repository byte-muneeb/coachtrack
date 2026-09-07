// Central role→module access map (approved matrix). Used by the sidebar (hide
// what you can't use) and the (app) layout (redirect if a page is opened
// directly). The BACKEND enforces the same rules on the API — this is UX, not
// the security boundary.
export type Role = "super_admin" | "entity_admin" | "branch_manager" | "accountant" | "front_desk" | "teacher";

const ALL: Role[] = ["entity_admin", "branch_manager", "accountant", "front_desk", "teacher"];

// Keyed by route path. Longest-prefix match wins (so /students/register can be
// stricter than /students). entity_admin is implicitly allowed everywhere.
export const MODULE_ROLES: Record<string, Role[]> = {
  "/dashboard": ALL,
  "/students/register": ["branch_manager", "front_desk"],
  "/students": ["branch_manager", "accountant", "front_desk", "teacher"], // view+ for all
  "/import": ["branch_manager"],
  "/admissions": ["branch_manager", "front_desk"],
  "/courses": ["branch_manager", "teacher"],
  "/attendance": ["branch_manager", "teacher"],
  "/tests": ["branch_manager", "teacher"],
  "/fees": ["branch_manager", "accountant"],
  "/vouchers": ["branch_manager", "accountant", "front_desk"],
  "/reminders": ["branch_manager", "accountant"],
  "/expenses": ["branch_manager", "accountant"],
  "/reports": ["branch_manager", "accountant"],
  "/branches": [],       // entity_admin only
  "/users": ["branch_manager"],
  "/audit": [],          // entity_admin only
  "/settings": [],       // entity_admin only
};

// Can this role open this path? entity_admin/super_admin: always. Others: match
// the most specific configured prefix.
export function canAccess(role: string | undefined | null, path: string): boolean {
  if (!role) return false;
  if (role === "entity_admin" || role === "super_admin") return true;
  const keys = Object.keys(MODULE_ROLES).sort((a, b) => b.length - a.length);
  const key = keys.find((k) => path === k || path.startsWith(k + "/"));
  if (!key) return true; // unlisted routes (e.g. /parent) are not gated here
  return MODULE_ROLES[key].includes(role as Role);
}
