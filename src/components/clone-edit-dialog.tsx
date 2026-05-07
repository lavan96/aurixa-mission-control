import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Clone } from "@/lib/queries";

export function CloneEditDialog({
  clone,
  open,
  onOpenChange,
  onSaved,
}: {
  clone: Clone | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clone) return;
    setName(clone.name);
    setTags((clone.tags ?? []).join(", "));
    setNotes(clone.notes ?? "");
  }, [clone]);

  const save = async () => {
    if (!clone) return;
    if (!name.trim()) return toast.error("Name required");
    setSaving(true);
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("clones")
      .update({
        name: name.trim(),
        tags: tagList,
        notes: notes.trim() || null,
      })
      .eq("id", clone.id);
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }
    await supabase.from("audit_log").insert({
      action: "clone.metadata_updated",
      entity_type: "clone",
      entity_id: clone.id,
      actor_user_id: user?.id ?? null,
      metadata: { name, tags: tagList },
    });
    toast.success("Clone updated");
    setSaving(false);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit clone</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="staging, eu-west" />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
