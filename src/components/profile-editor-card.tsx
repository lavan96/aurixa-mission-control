import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { UserCircle2 } from "lucide-react";

export function ProfileEditorCard() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) toast.error(error.message);
      if (data) {
        setProfileId(data.id);
        setDisplayName(data.display_name ?? "");
        setAvatarUrl(data.avatar_url ?? "");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      if (profileId) {
        const { error } = await supabase
          .from("profiles")
          .update({ display_name: displayName.trim() || null, avatar_url: avatarUrl.trim() || null })
          .eq("id", profileId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("profiles")
          .insert({ user_id: userId, display_name: displayName.trim() || null, avatar_url: avatarUrl.trim() || null })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (data) setProfileId(data.id);
      }
      toast.success("Profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCircle2 className="h-4 w-4" /> Your profile
        </CardTitle>
        <CardDescription>
          How you appear across audit logs, role assignments, and notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Display name</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={loading || !userId}
            placeholder={session?.user.email ?? "Operator"}
          />
        </div>
        <div className="space-y-2">
          <Label>Avatar URL</Label>
          <Input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            disabled={loading || !userId}
            placeholder="https://…"
          />
        </div>
        <div className="md:col-span-2 flex items-center justify-between">
          <div className="font-mono text-[11px] text-muted-foreground">
            {session?.user.email ?? ""}
          </div>
          <Button onClick={save} disabled={saving || loading || !userId}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
