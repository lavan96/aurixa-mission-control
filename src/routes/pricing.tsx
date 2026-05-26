import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Sparkles,
  Zap,
  Users,
  Puzzle,
  Wrench,
  FileText,
  ShieldCheck,
  Infinity as InfinityIcon,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { getPublicPricing } from "@/lib/public-pricing.functions";
import { createStripeCheckout } from "@/lib/stripe.functions";
import { useAuth } from "@/lib/auth";

type PricingSearch = { intent?: string };

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  validateSearch: (s: Record<string, unknown>): PricingSearch => ({
    intent: typeof s.intent === "string" ? s.intent : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Pricing — Aurixa Systems" },
      {
        name: "description",
        content:
          "Plans, seats, credits and add-ons. Transparent pricing built for advisory firms, buyers agents and property professionals.",
      },
      { property: "og:title", content: "Pricing — Aurixa Systems" },
      {
        property: "og:description",
        content:
          "Plans, seats, credits and add-ons. Transparent pricing built for advisory firms, buyers agents and property professionals.",
      },
    ],
  }),
});


const aud = (cents: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const range = (min: number | null | undefined, max: number | null | undefined, _ccy = "AUD") => {
  if (min == null) return "—";
  if (max == null || max === min) return aud(min);
  return `${aud(min)} – ${aud(max)}`;
};

const MARQUEE_WORDS = [
  "Pricing",
  "Seats",
  "Credits",
  "Modules",
  "Onboarding",
  "Reports",
  "Cascades",
  "Fleet",
  "Branding",
  "Aurixa",
];

function PricingPage() {
  const fetchCatalog = useServerFn(getPublicPricing);
  const { data, isLoading } = useQuery({
    queryKey: ["public-pricing"],
    queryFn: () => fetchCatalog(),
  });

  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const { session } = useAuth();
  const nav = useNavigate();
  const search = useSearch({ from: "/pricing" }) as PricingSearch;
  const checkoutFn = useServerFn(createStripeCheckout);
  const [busyId, setBusyId] = useState<string | null>(null);
  const autoLaunchedRef = useRef(false);

  const startCheckout = async (
    mode: "seat_plan" | "topup" | "setup_package",
    itemId: string,
  ) => {
    // Unauthenticated: route to auth with redirect + intent for auto-launch on return.
    if (!session) {
      nav({
        to: "/auth" as never,
        search: { redirect: "/pricing", intent: `${mode}:${itemId}` } as never,
      });
      return;
    }
    // Top-ups & setup packages need a tenant context — send users to the
    // signed-in billing pages where tenant is resolved.
    if (mode === "topup") {
      nav({ to: "/billing/topup" as never });
      return;
    }
    if (mode === "setup_package") {
      nav({ to: "/billing/catalog" as never });
      return;
    }
    // Seat plan → direct Stripe checkout (Prime entitlement, no clone).
    setBusyId(itemId);
    try {
      const res = await checkoutFn({
        data: { mode, itemId, cloneId: null },
      });
      if (res.ok && res.url) {
        window.location.href = res.url;
        return;
      }
      toast.error(
        res.ok
          ? "Checkout could not be started"
          : `Checkout unavailable: ${res.error.replaceAll("_", " ")}`,
      );
    } catch (err) {
      toast.error((err as Error).message ?? "Checkout failed");
    } finally {
      setBusyId(null);
    }
  };

  // Auto-resume checkout after auth round-trip.
  useEffect(() => {
    if (autoLaunchedRef.current) return;
    if (!session || !search.intent) return;
    const [mode, itemId] = search.intent.split(":");
    if (!mode || !itemId) return;
    if (mode !== "seat_plan" && mode !== "topup" && mode !== "setup_package") return;
    autoLaunchedRef.current = true;
    // Clear the intent param so we don't loop.
    nav({ to: "/pricing" as never, search: {} as never, replace: true });
    void startCheckout(mode, itemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, search.intent]);

  const plans = useMemo(() => data?.plans ?? [], [data]);
  const packs = data?.packs ?? [];
  const setups = data?.setups ?? [];
  const addons = data?.addons ?? [];
  const reports = data?.reports ?? [];


  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <BackgroundFX />

      {/* Top nav */}
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="font-mono text-[11px] tracking-[0.4em] text-foreground/90">
            AURIXA
          </span>
        </Link>
        <nav className="hidden items-center gap-8 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground md:flex">
          <a href="#plans" className="hover:text-foreground transition-colors">Plans</a>
          <a href="#credits" className="hover:text-foreground transition-colors">Credits</a>
          <a href="#addons" className="hover:text-foreground transition-colors">Add-ons</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <Link to="/auth">
          <Button variant="outline" size="sm" className="border-border/60 font-mono text-[11px] uppercase tracking-[0.2em]">
            Sign in
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-10 pb-16 md:pt-20 md:pb-24">
        {/* tiny meta strip */}
        <div className="reveal-up mb-10 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-1 w-1 animate-pulse rounded-full bg-accent" />
            Index · 001 / Pricing
          </span>
          <span className="hidden md:inline">
            v.2026 · AUD · ex GST
          </span>
        </div>

        <div className="mx-auto max-w-5xl text-center">
          <Badge
            variant="outline"
            className="reveal-up mb-8 border-primary/40 bg-primary/5 font-mono text-[10px] uppercase tracking-[0.35em] text-primary"
          >
            <Sparkles className="mr-1.5 h-3 w-3" /> Plans & Pricing
          </Badge>
          <h1
            className="reveal-up text-balance text-[44px] font-semibold leading-[0.95] tracking-[-0.03em] md:text-[96px]"
            style={{ animationDelay: "120ms" }}
          >
            <span className="shimmer-text">Pricing built</span>
            <br />
            <span className="text-foreground/90">for firms </span>
            <span className="font-display italic text-primary-glow">in&nbsp;motion</span>
            <span className="text-foreground/90">.</span>
          </h1>
          <p
            className="reveal-up mx-auto mt-8 max-w-2xl text-balance text-[15px] leading-relaxed text-muted-foreground md:text-lg"
            style={{ animationDelay: "240ms" }}
          >
            Pick a plan. Scale seats. Top up credits as you grow. Every tier,
            module and add-on — laid bare below, with{" "}
            <span className="font-display italic text-foreground">no surprises</span>.
          </p>

          {/* Billing toggle */}
          <div
            className="reveal-up mt-12 inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 p-1 backdrop-blur-xl"
            style={{ animationDelay: "360ms" }}
          >
            {(["monthly", "annual"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBilling(b)}
                className={`relative rounded-full px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.25em] transition-all ${
                  billing === b
                    ? "bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-[0_0_40px_-6px] shadow-primary/70"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b}
                {b === "annual" && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider ${
                    billing === "annual" ? "bg-background/20 text-primary-foreground" : "bg-accent/20 text-accent"
                  }`}>
                    -15%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Marquee */}
        <div className="reveal-up relative mt-20 overflow-hidden border-y border-border/40 py-5" style={{ animationDelay: "480ms" }}>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-background to-transparent" />
          <div className="marquee-track flex w-max gap-12 whitespace-nowrap">
            {[...MARQUEE_WORDS, ...MARQUEE_WORDS, ...MARQUEE_WORDS].map((w, i) => (
              <span
                key={i}
                className="flex items-center gap-12 font-display text-3xl italic text-muted-foreground/40 md:text-5xl"
              >
                {w}
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <SectionHeader
          index="02"
          eyebrow="Plans"
          title={<>The <span className="font-display italic text-primary-glow">tiers</span>.</>}
          description="Four shapes. One philosophy. Pay only for what your firm actually uses."
        />

        {isLoading && (
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[500px] animate-pulse rounded-2xl bg-card/40" />
            ))}
          </div>
        )}

        {!isLoading && plans.length > 0 && (
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((p: any, idx: number) => {
              const meta = p.metadata ?? {};
              const minP = meta.price_min_cents ?? p.price_cents;
              const maxP = meta.price_max_cents ?? p.price_cents;
              const annual = Math.round(minP * 0.85);
              const display = billing === "annual" ? annual : minP;
              const isFeatured = idx === plans.length - 2 || meta.tier === 3;
              const highlights: string[] = meta.highlights ?? [];
              const tierName =
                meta.tier === 4 ? "Enterprise" :
                meta.tier === 3 ? "Most popular" :
                meta.tier === 2 ? "Recommended" :
                "Starter";

              const isEnterprise = p.seat_limit >= 999;
              return (
                <PlanCard
                  key={p.id}
                  index={String(idx + 1).padStart(2, "0")}
                  featured={isFeatured}
                  name={p.name}
                  tagline={meta.best_for ?? p.description ?? ""}
                  price={display}
                  priceMax={maxP}
                  showRange={maxP !== minP && billing === "monthly"}
                  ribbon={tierName}
                  seats={isEnterprise ? "Custom seats" : `${p.seat_limit} seats included`}
                  highlights={highlights}
                  cta={isEnterprise ? "Talk to sales" : "Get started"}
                  busy={busyId === p.id}
                  onCta={
                    isEnterprise
                      ? () => nav({ to: "/auth" as never })
                      : () => startCheckout("seat_plan", p.id)
                  }
                />
              );
            })}

          </div>
        )}

        <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          All prices in AUD · excl. GST · Annual saves 15%
        </p>
      </section>

      {/* Credit packs */}
      <section id="credits" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <SectionHeader
          index="03"
          eyebrow="Credits"
          title={<>Top up <span className="font-display italic text-accent">on demand</span>.</>}
          description="Generate more reports, scenarios and AI insights with credit packs. Never expires for active accounts."
          icon={<Zap className="h-4 w-4" />}
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {packs.slice(0, 8).map((pack: any, i: number) => {
            const meta = pack.metadata ?? {};
            const popular = !!meta.popular;
            return (
              <div
                key={pack.id}
                className={`group relative overflow-hidden rounded-2xl border bg-card/40 p-6 backdrop-blur-xl transition-all duration-500 hover:-translate-y-1.5 hover:border-primary/50 hover:bg-card/70 hover:shadow-[0_30px_80px_-30px] hover:shadow-primary/40 ${
                  popular ? "border-accent/60" : "border-border/40"
                }`}
              >
                <CornerTicks />
                {popular && (
                  <Badge className="absolute right-4 top-4 border-0 bg-accent text-accent-foreground font-mono text-[9px] uppercase tracking-wider">
                    Popular
                  </Badge>
                )}
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  <span>{pack.name}</span>
                  <span className="text-foreground/30">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="bg-gradient-to-br from-foreground via-foreground to-primary-glow bg-clip-text text-4xl font-semibold tracking-tight text-transparent">
                    {pack.tokens.toLocaleString()}
                  </span>
                  <span className="font-display text-base italic text-muted-foreground">credits</span>
                </div>
                <div className="mt-1.5 font-mono text-xs text-muted-foreground">
                  {aud(pack.price_cents)} AUD
                </div>
                {meta.best_for && (
                  <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                    {meta.best_for}
                  </p>
                )}
                <div className="mt-6 flex items-center font-mono text-[10px] uppercase tracking-[0.25em] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Purchase <ArrowRight className="ml-1.5 h-3 w-3" />
                </div>
                {/* hover spotlight */}
                <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,oklch(0.78_0.16_200/0.12),transparent_60%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              </div>
            );
          })}
        </div>
      </section>

      {/* Modules / setup / reports */}
      <section id="addons" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <SectionHeader
          index="04"
          eyebrow="Build your stack"
          title={<>Modules, onboarding & <span className="font-display italic text-primary-glow">report economics</span>.</>}
          description="Mix and match what your firm actually uses. All optional, all transparent."
          icon={<Puzzle className="h-4 w-4" />}
        />

        <Tabs defaultValue="addons" className="mt-14">
          <TabsList className="mx-auto grid w-full max-w-xl grid-cols-3 border border-border/40 bg-card/60 backdrop-blur-xl">
            <TabsTrigger value="addons" className="font-mono text-[11px] uppercase tracking-[0.2em]">Add-ons</TabsTrigger>
            <TabsTrigger value="setup" className="font-mono text-[11px] uppercase tracking-[0.2em]">Onboarding</TabsTrigger>
            <TabsTrigger value="reports" className="font-mono text-[11px] uppercase tracking-[0.2em]">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="addons" className="mt-10">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {addons.map((a: any) => (
                <Card
                  key={a.id}
                  className="group relative overflow-hidden border-border/40 bg-card/40 backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-primary/40 hover:bg-card/60"
                >
                  <CornerTicks />
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base tracking-tight">{a.name}</CardTitle>
                      <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-wider">
                        {a.category}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">{a.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg font-semibold tracking-tight">
                      {range(a.price_min_cents, a.price_max_cents, a.currency)}
                      <span className="ml-1.5 font-display text-sm italic font-normal text-muted-foreground">
                        / {a.billing_period}
                      </span>
                    </div>
                    {a.included_in_plans?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {a.included_in_plans.map((pl: string) => (
                          <Badge
                            key={pl}
                            variant="secondary"
                            className="font-mono text-[9px] uppercase tracking-wider"
                          >
                            included · {pl}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="setup" className="mt-10">
            <div className="grid gap-4 md:grid-cols-2">
              {setups.map((s: any) => (
                <Card
                  key={s.id}
                  className="group relative overflow-hidden border-border/40 bg-card/40 backdrop-blur-xl transition-all hover:border-primary/40"
                >
                  <CornerTicks />
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/30">
                          <Wrench className="h-4 w-4" />
                        </div>
                        <CardTitle className="text-base tracking-tight">{s.name}</CardTitle>
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px] tracking-wider">
                        {range(s.price_min_cents, s.price_max_cents, s.currency)}
                      </Badge>
                    </div>
                    <CardDescription>{s.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2.5 text-sm">
                      {(s.deliverables as string[] | null)?.map((d, i) => (
                        <li key={i} className="flex gap-2.5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span className="text-muted-foreground">{d}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="reports" className="mt-10">
            <Card className="relative overflow-hidden border-border/40 bg-card/40 backdrop-blur-xl">
              <CornerTicks />
              <CardContent className="p-0">
                <div className="divide-y divide-border/40">
                  <div className="grid grid-cols-12 gap-2 px-6 py-4 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    <div className="col-span-6">Report</div>
                    <div className="col-span-3">Category</div>
                    <div className="col-span-3 text-right">Credits</div>
                  </div>
                  {reports.map((r: any) => (
                    <div
                      key={r.id}
                      className="grid grid-cols-12 items-center gap-2 px-6 py-4 text-sm transition-colors hover:bg-surface-elevated/40"
                    >
                      <div className="col-span-6 font-medium tracking-tight">{r.name}</div>
                      <div className="col-span-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {r.category}
                      </div>
                      <div className="col-span-3 text-right font-mono text-primary">
                        {r.credit_cost}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Credits consumed only on successful generation.
            </p>
          </TabsContent>
        </Tabs>
      </section>

      {/* Trust strip */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="relative grid gap-8 overflow-hidden rounded-3xl border border-border/40 bg-gradient-to-br from-card/70 via-card/30 to-card/70 p-10 backdrop-blur-xl md:grid-cols-3">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_50%,oklch(0.78_0.16_200/0.08),transparent_60%),radial-gradient(circle_at_80%_50%,oklch(0.86_0.20_130/0.08),transparent_60%)]" />
          <Trust icon={<ShieldCheck className="h-5 w-5" />} title="Enterprise security" body="SSO, audit logs, role-based access and isolated tenancy by default." />
          <Trust icon={<InfinityIcon className="h-5 w-5" />} title="Scales with you" body="Add seats, devices and credits the moment the team needs them." />
          <Trust icon={<Users className="h-5 w-5" />} title="Hands-on onboarding" body="A real human walks your team through setup and rollout." />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 mx-auto max-w-3xl px-6 pb-32">
        <SectionHeader
          index="05"
          eyebrow="FAQ"
          title={<>Questions, <span className="font-display italic text-primary-glow">answered</span>.</>}
          icon={<FileText className="h-4 w-4" />}
        />
        <Accordion type="single" collapsible className="mt-10">
          <FaqItem q="How do credits work?" a="Every AI-generated report or scenario consumes credits based on its complexity. Each plan includes a monthly allowance; you can top up anytime with credit packs that never expire while your account is active." />
          <FaqItem q="Can I change plans later?" a="Absolutely. Upgrade, downgrade or change seat counts whenever your firm changes shape. Pro-rated billing applies on the next cycle." />
          <FaqItem q="What does onboarding include?" a="A dedicated specialist walks your team through configuration, brand setup, workflows and training. Larger packages include migration, integrations and white-label theming." />
          <FaqItem q="Do you offer annual billing?" a="Yes — flip the toggle at the top of the page for a 15% discount on annual prepayment. We also offer multi-year terms for Enterprise customers." />
          <FaqItem q="Is there a free trial?" a="Reach out through the Get started flow. We'll set up a sandbox environment so your team can road-test the platform with sample data." />
        </Accordion>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-32">
        <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-10 text-center md:p-20">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,theme(colors.primary/20),transparent_60%)]" />
          <div className="absolute inset-0 -z-10 opacity-[0.04] noise-overlay" />
          <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-primary/80">
            06 / Next move
          </div>
          <h2 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.02em] md:text-6xl">
            Ready <span className="font-display italic text-primary-glow">when</span> you are.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-balance text-muted-foreground md:text-lg">
            Spin up a workspace today, or book a walkthrough with our team to see
            it on your data.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="shadow-[0_0_50px_-10px] shadow-primary/70 font-mono text-[11px] uppercase tracking-[0.25em]">
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline" className="border-border/60 font-mono text-[11px] uppercase tracking-[0.25em]">
                Talk to sales
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/40 bg-background/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2.5">
            <LogoMark small />
            <span>© {new Date().getFullYear()} Aurixa · All rights reserved</span>
          </div>
          <div className="flex gap-6">
            <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
            <a href="#plans" className="hover:text-foreground transition-colors">Plans</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- subcomponents ---------------- */

function CornerTicks() {
  return (
    <>
      <span className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l border-t border-primary/40" />
      <span className="pointer-events-none absolute right-2 top-2 h-3 w-3 border-r border-t border-primary/40" />
      <span className="pointer-events-none absolute left-2 bottom-2 h-3 w-3 border-l border-b border-primary/40" />
      <span className="pointer-events-none absolute right-2 bottom-2 h-3 w-3 border-r border-b border-primary/40" />
    </>
  );
}

function PlanCard({
  index,
  name,
  tagline,
  price,
  priceMax,
  showRange,
  ribbon,
  seats,
  highlights,
  cta,
  ctaTo,
  featured,
}: {
  index: string;
  name: string;
  tagline: string;
  price: number;
  priceMax: number;
  showRange: boolean;
  ribbon: string;
  seats: string;
  highlights: string[];
  cta: string;
  ctaTo: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border p-7 backdrop-blur-xl transition-all duration-500 hover:-translate-y-1.5 ${
        featured
          ? "border-primary/60 bg-gradient-to-br from-primary/15 via-card/80 to-card/40 shadow-[0_40px_100px_-30px] shadow-primary/50"
          : "border-border/50 bg-card/40 hover:border-primary/40 hover:shadow-[0_30px_80px_-30px] hover:shadow-primary/30"
      }`}
    >
      <CornerTicks />
      {featured && (
        <>
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
          <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-accent to-transparent" />
          <Badge className="absolute right-5 top-5 border-0 bg-gradient-to-r from-primary to-accent font-mono text-[9px] uppercase tracking-[0.2em] text-primary-foreground">
            {ribbon}
          </Badge>
        </>
      )}

      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        <span>{name}</span>
        <span className="text-foreground/30">{index}</span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{tagline}</p>

      <div className="mt-7">
        <div className="flex items-baseline gap-1.5">
          <span className={`bg-gradient-to-br ${featured ? "from-foreground via-foreground to-primary-glow" : "from-foreground to-foreground/50"} bg-clip-text text-5xl font-semibold tracking-[-0.03em] text-transparent`}>
            {aud(price)}
          </span>
          {showRange && priceMax > price && (
            <span className="font-display text-base italic text-muted-foreground">
              – {aud(priceMax)}
            </span>
          )}
        </div>
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          AUD / month · ex GST
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border/40 bg-background/40 px-3 py-2 font-mono text-[11px] tracking-wider text-foreground/80">
        {seats}
      </div>

      <ul className="mt-6 flex-1 space-y-3 text-sm">
        {highlights.map((h, i) => (
          <li key={i} className="flex gap-2.5">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? "text-accent" : "text-primary"}`} />
            <span className="text-muted-foreground">{h}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <Link to={ctaTo}>
          <Button
            className={`w-full font-mono text-[11px] uppercase tracking-[0.25em] ${
              featured
                ? "bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-[0_0_40px_-8px] shadow-primary/70"
                : ""
            }`}
            variant={featured ? "default" : "outline"}
          >
            {cta}
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function SectionHeader({
  index,
  eyebrow,
  title,
  description,
  icon,
}: {
  index?: string;
  eyebrow: string;
  title: React.ReactNode;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="mx-auto inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
        {index && <span className="text-foreground/40">{index}</span>}
        {index && <span className="h-px w-8 bg-border" />}
        {icon}
        <span>{eyebrow}</span>
      </div>
      <h2 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.025em] md:text-6xl">
        {title}
      </h2>
      {description && (
        <p className="mx-auto mt-4 max-w-xl text-balance text-sm leading-relaxed text-muted-foreground md:text-base">
          {description}
        </p>
      )}
    </div>
  );
}

function Trust({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
        {icon}
      </div>
      <div>
        <h4 className="font-semibold tracking-tight">{title}</h4>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <AccordionItem value={q} className="border-border/40">
      <AccordionTrigger className="text-left text-base font-medium tracking-tight hover:text-primary">
        {q}
      </AccordionTrigger>
      <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
        {a}
      </AccordionContent>
    </AccordionItem>
  );
}

function LogoMark({ small }: { small?: boolean }) {
  const size = small ? "h-5 w-5" : "h-7 w-7";
  return (
    <div className={`relative ${size}`}>
      <div className="absolute inset-0 rounded-md bg-gradient-to-br from-primary via-primary-glow to-accent" />
      <div className="absolute inset-[2px] rounded-[4px] bg-background" />
      <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold text-primary">
        A
      </div>
    </div>
  );
}

function BackgroundFX() {
  return (
    <>
      {/* animated aurora */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1100px]">
        <div className="aurora absolute inset-0" />
      </div>
      {/* lower aurora */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[700px] opacity-60">
        <div className="aurora absolute inset-0" style={{ animationDirection: "alternate-reverse" }} />
      </div>
      {/* fine grid with vignette */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 80%)",
        }}
      />
      {/* film grain */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04] noise-overlay" />
      {/* horizon line */}
      <div className="pointer-events-none absolute inset-x-0 top-[90vh] -z-10 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    </>
  );
}
