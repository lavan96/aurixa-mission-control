import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Crown,
  Shield,
  Wrench,
  User,
  Check,
  X,
  Minus,
  Grid3x3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLES: Array<{
  role: AppRole;
  label: string;
  level: number;
  icon: typeof Crown;
  color: string;
}> = [
  { role: "super_admin", label: "Super Admin", level: 100, icon: Crown, color: "text-warning" },
  { role: "admin", label: "Admin", level: 80, icon: Shield, color: "text-primary" },
  { role: "operator", label: "Operator", level: 50, icon: Wrench, color: "text-accent" },
  { role: "user", label: "User", level: 10, icon: User, color: "text-muted-foreground" },
];

type Capability =
  | "full" // ✓
  | "limited" // ◦
  | "none"; // ✗

type PermissionRow = {
  category: string;
  capability: string;
  description: string;
  access: Record<AppRole, Capability>;
};

const PERMISSIONS: PermissionRow[] = [
  // ── Role Management ──
  {
    category: "Role Management",
    capability: "Assign super_admin",
    description: "No one can assign super_admin — it's system-seeded only",
    access: { super_admin: "none", admin: "none", operator: "none", user: "none" },
  },
  {
    category: "Role Management",
    capability: "Assign admin",
    description: "Only super_admin (level 100 > 80)",
    access: { super_admin: "full", admin: "none", operator: "none", user: "none" },
  },
  {
    category: "Role Management",
    capability: "Assign operator",
    description: "Admin+ can assign operator (level 80+ > 50)",
    access: { super_admin: "full", admin: "full", operator: "none", user: "none" },
  },
  {
    category: "Role Management",
    capability: "Assign user",
    description: "Operator+ can assign user (level 50+ > 10)",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  {
    category: "Role Management",
    capability: "Revoke roles",
    description: "Can only revoke from users with lower role level",
    access: { super_admin: "full", admin: "limited", operator: "limited", user: "none" },
  },
  {
    category: "Role Management",
    capability: "View all roles",
    description: "Admin+ can see all users' roles",
    access: { super_admin: "full", admin: "full", operator: "none", user: "none" },
  },
  // ── Fleet Management ──
  {
    category: "Fleet Management",
    capability: "View clones",
    description: "Read access to all clones",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  {
    category: "Fleet Management",
    capability: "Create clones",
    description: "Provision new clone repos",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  {
    category: "Fleet Management",
    capability: "Delete clones",
    description: "Permanently remove clones (admin+ only)",
    access: { super_admin: "full", admin: "full", operator: "none", user: "none" },
  },
  {
    category: "Fleet Management",
    capability: "Manage backends",
    description: "Provision / retry clone dedicated backends",
    access: { super_admin: "full", admin: "full", operator: "none", user: "none" },
  },
  // ── Cascades ──
  {
    category: "Cascades",
    capability: "View cascades",
    description: "Read cascade events and results",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  {
    category: "Cascades",
    capability: "Execute cascades",
    description: "Trigger cascade operations",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  {
    category: "Cascades",
    capability: "Approve cascades",
    description: "Second-operator approval for high-blast-radius cascades",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  // ── Modules ──
  {
    category: "Modules",
    capability: "View modules",
    description: "Browse the module catalog",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  {
    category: "Modules",
    capability: "Install / remove modules",
    description: "Modify clone module sets",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  {
    category: "Modules",
    capability: "Detect modules (AI)",
    description: "Run AI module detection on prime",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  // ── Settings ──
  {
    category: "Settings",
    capability: "Edit prime config",
    description: "Change prime repo, default branch, cascade mode",
    access: { super_admin: "full", admin: "full", operator: "none", user: "none" },
  },
  {
    category: "Settings",
    capability: "Manage GitHub App",
    description: "Configure App secrets and webhook",
    access: { super_admin: "full", admin: "full", operator: "none", user: "none" },
  },
  {
    category: "Settings",
    capability: "View audit log",
    description: "Read operational audit trail",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
  // ── Notifications ──
  {
    category: "Notifications",
    capability: "Manage own push",
    description: "Enable/disable push notifications on own devices",
    access: { super_admin: "full", admin: "full", operator: "full", user: "full" },
  },
  {
    category: "Notifications",
    capability: "View all subscriptions",
    description: "See all push device subscriptions",
    access: { super_admin: "full", admin: "full", operator: "full", user: "none" },
  },
];

function CapCell({ cap }: { cap: Capability }) {
  if (cap === "full")
    return (
      <div className="flex justify-center">
        <Check className="h-4 w-4 text-success" />
      </div>
    );
  if (cap === "limited")
    return (
      <div className="flex justify-center">
        <Minus className="h-4 w-4 text-warning" />
      </div>
    );
  return (
    <div className="flex justify-center">
      <X className="h-4 w-4 text-muted-foreground/40" />
    </div>
  );
}

export const Route = createFileRoute("/settings/permission-matrix")({
  component: () => (
    <ProtectedRoute>
      <PermissionMatrixPage />
    </ProtectedRoute>
  ),
  head: () => ({
    meta: [{ title: "Permission Matrix — Aurixa Systems Mission Control" }],
  }),
});

function PermissionMatrixPage() {
  // Group permissions by category
  const categories = Array.from(new Set(PERMISSIONS.map((p) => p.category)));

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
          <Grid3x3 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            rbac matrix
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Permission Matrix
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What each role can do inside the dashboard. Role levels enforce
            strict hierarchy — you can never act above your own level.
          </p>
        </div>
      </header>

      {/* Legend */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-4">
          <div className="flex items-center gap-1.5 text-sm">
            <Check className="h-4 w-4 text-success" />{" "}
            <span>Full access</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Minus className="h-4 w-4 text-warning" />{" "}
            <span>Limited (hierarchy-scoped)</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <X className="h-4 w-4 text-muted-foreground/40" />{" "}
            <span>No access</span>
          </div>
        </CardContent>
      </Card>

      {categories.map((cat) => (
        <Card key={cat}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{cat}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Capability</TableHead>
                  {ROLES.map((r) => {
                    const Icon = r.icon;
                    return (
                      <TableHead key={r.role} className="text-center w-[100px]">
                        <div className="flex flex-col items-center gap-1">
                          <Icon className={cn("h-4 w-4", r.color)} />
                          <span className="text-[10px] font-mono">
                            {r.label}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono"
                          >
                            {r.level}
                          </Badge>
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {PERMISSIONS.filter((p) => p.category === cat).map((perm) => (
                  <TableRow key={perm.capability}>
                    <TableCell>
                      <div>
                        <div className="text-sm font-medium">
                          {perm.capability}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {perm.description}
                        </div>
                      </div>
                    </TableCell>
                    {ROLES.map((r) => (
                      <TableCell key={r.role} className="text-center">
                        <CapCell cap={perm.access[r.role]} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
