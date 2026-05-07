// Brand profile JSON import/export — round-trip a profile across environments.
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useServerAction } from "@/lib/use-server-action";
import { upsertBrandProfile } from "@/server/branding.functions";

type BrandProfile = Database["public"]["Tables"]["clone_brand_profiles"]["Row"];

export function BrandProfileIO({
  profile,
  onImported,
}: {
  profile?: BrandProfile;
  onImported?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upsert = useServerAction(upsertBrandProfile, {
    successMessage: "Profile imported",
  });

  const exportProfile = () => {
    if (!profile) return;
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      profile: {
        name: profile.name,
        slug: profile.slug,
        description: profile.description,
        brand_config: profile.brand_config,
        report_contact: profile.report_contact,
        asset_manifest: profile.asset_manifest,
        tags: profile.tags,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `brand-${profile.slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProfile = async (file: File) => {
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt) as { profile?: Record<string, unknown> };
      const p = parsed.profile;
      if (!p || typeof p !== "object" || !("name" in p) || !("brand_config" in p)) {
        toast.error("Invalid brand profile JSON");
        return;
      }
      await upsert.execute({
        data: {
          name: `${p.name} (imported)`,
          slug: undefined,
          description: (p.description as string) ?? null,
          brand_config: p.brand_config as never,
          report_contact: (p.report_contact ?? {}) as never,
          asset_manifest: (p.asset_manifest ?? []) as never,
          tags: (p.tags as string[]) ?? [],
          is_default: false,
        },
      });
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <div className="flex items-center gap-2">
      {profile && (
        <Button size="sm" variant="outline" onClick={exportProfile}>
          <Download className="mr-1 h-3 w-3" /> Export
        </Button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importProfile(f);
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
        <Upload className="mr-1 h-3 w-3" /> Import
      </Button>
    </div>
  );
}
