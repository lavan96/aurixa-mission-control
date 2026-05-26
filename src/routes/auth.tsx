import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
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

type AuthSearch = { redirect?: string; intent?: string };

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  validateSearch: (s: Record<string, unknown>): AuthSearch => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
    intent: typeof s.intent === "string" ? s.intent : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in — Aurixa Systems Mission Control" }] }),
});

function AuthPage() {
  const { session, signIn, signUp } = useAuth();
  const nav = useNavigate();
  const search = useSearch({ from: "/auth" }) as AuthSearch;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      const dest = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/dashboard";
      const qs = search.intent ? `${dest.includes("?") ? "&" : "?"}intent=${encodeURIComponent(search.intent)}` : "";
      nav({ to: (dest + qs) as never });
    }
  }, [session, nav, search.redirect, search.intent]);


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
      // Check if a session was created (email confirmation disabled) or not (confirmation required)
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        toast.success("Account created — welcome aboard");
      } else {
        setPendingEmail(email);
        toast.success("Account created — check your inbox to confirm");
      }
    } else {
      toast.success("Welcome back");
    }
  };

  const resendConfirmation = async () => {
    if (!pendingEmail) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Confirmation email re-sent");
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

          {pendingEmail && (
            <Alert className="mt-6 border-primary/40 bg-primary/5">
              <MailCheck className="h-4 w-4 text-primary" />
              <AlertTitle className="font-mono text-sm">Confirm your email</AlertTitle>
              <AlertDescription className="space-y-3 text-xs text-muted-foreground">
                <p>
                  We sent a confirmation link to{" "}
                  <span className="font-mono text-foreground">{pendingEmail}</span>. Click it to
                  finish setup, then sign in below.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={resendConfirmation}
                  >
                    Resend email
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingEmail(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
