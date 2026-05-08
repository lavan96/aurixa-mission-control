import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Radio, MailCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({ meta: [{ title: "Sign in — Aurixa Systems Mission Control" }] }),
});

function AuthPage() {
  const { session, signIn, signUp } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) nav({ to: "/dashboard" });
  }, [session, nav]);

  const handle = async (mode: "in" | "up") => {
    setBusy(true);
    const fn = mode === "in" ? signIn : signUp;
    const { error } = await fn(email, password);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (mode === "up") {
      toast.success("Account created. Check your email if confirmation is required.");
    } else {
      toast.success("Welcome back");
    }
  };

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
      <Card className="border-border/80 bg-card/90 backdrop-blur">
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
            <Radio className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-mono tracking-wide">AURIXA SYSTEMS · MISSION CONTROL</CardTitle>
          <CardDescription>Operator access required</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="in">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="in">Sign in</TabsTrigger>
              <TabsTrigger value="up">Sign up</TabsTrigger>
            </TabsList>
            {(["in", "up"] as const).map((mode) => (
              <TabsContent key={mode} value={mode} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`email-${mode}`}>Email</Label>
                  <Input
                    id={`email-${mode}`}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`pw-${mode}`}>Password</Label>
                  <Input
                    id={`pw-${mode}`}
                    type="password"
                    autoComplete={mode === "in" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button className="w-full" disabled={busy} onClick={() => handle(mode)}>
                  {mode === "in" ? "Sign in" : "Create account"}
                </Button>
                {mode === "up" && (
                  <p className="text-xs text-muted-foreground">
                    The first account created becomes the admin operator automatically.
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
