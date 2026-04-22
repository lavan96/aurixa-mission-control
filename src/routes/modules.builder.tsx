import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { ModuleBuilder } from "@/components/module-builder";

export const Route = createFileRoute("/modules/builder")({
  component: () => (
    <ProtectedRoute>
      <ModuleBuilderPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Module Builder — Aurixa Systems Mission Control" }] }),
});

function ModuleBuilderPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          configuration
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Module Builder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag and drop modules to attach or detach them per clone.
        </p>
      </header>

      <ModuleBuilder />
    </div>
  );
}
