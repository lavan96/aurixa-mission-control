import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
} from "lucide-react";

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

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
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

const range = (min: number | null | undefined, max: number | null | undefined, ccy = "AUD") => {
  if (min == null) return "—";
  if (max == null || max === min) return aud(min);
  return `${aud(min)} – ${aud(max)}`;
};

function PricingPage() {
  const fetchCatalog = useServerFn(getPublicPricing);
  const { data, isLoading } = useQuery({
    queryKey: ["public-pricing"],
    queryFn: () => fetchCatalog(),
  });

  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");

  const plans = useMemo(() => data?.plans ?? [], [data]);
  const packs = data?.packs ?? [];
  const setups = data?.setups ?? [];
  const addons = data?.addons ?? [];
  const reports = data?.reports ?? [];

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient background */}
      <BackgroundFX />

      {/* Top nav */}
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-mono text-sm tracking-[0.3em] text-foreground/90">
            AURIXA
          </span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#plans" className="hover:text-foreground">Plans</a>
          <a href="#credits" className="hover:text-foreground">Credits</a>
          <a href="#addons" className="hover:text-foreground">Add-ons</a>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
        </nav>
        <Link to="/auth">
          <Button variant="outline" size="sm" className="border-border/60">
            Sign in
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <Badge
            variant="outline"
            className="mb-6 border-primary/40 bg-primary/5 font-mono text-[10px] uppercase tracking-[0.3em] text-primary"
          >
            <Sparkles className="mr-1.5 h-3 w-3" /> Pricing
          </Badge>
          <h1 className="font-display text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            <span className="bg-gradient-to-br from-foreground via-foreground to-foreground/40 bg-clip-text text-transparent">
              Pricing built for
            </span>
            <br />
            <span className="bg-gradient-to-r from-primary via-primary-glow to-accent bg-clip-text text-transparent">
              firms in motion.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
            Pick a plan, scale seats, top up credits as you grow. No surprises —
            every tier, module and add-on is laid out below.
          </p>

          {/* Billing toggle (visual only) */}
          <div className="mt-10 inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 p-1 backdrop-blur">
            {(["monthly", "annual"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBilling(b)}
                className={`relative rounded-full px-5 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
                  billing === b
                    ? "bg-primary text-primary-foreground shadow-[0_0_30px_-8px] shadow-primary/60"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b}
                {b === "annual" && (
                  <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-bold text-accent">
                    -15%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        {isLoading && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[480px] animate-pulse rounded-2xl bg-card/40" />
            ))}
          </div>
        )}

        {!isLoading && plans.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
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

              return (
                <PlanCard
                  key={p.id}
                  featured={isFeatured}
                  name={p.name}
                  tagline={meta.best_for ?? p.description ?? ""}
                  price={display}
                  priceMax={maxP}
                  showRange={maxP !== minP && billing === "monthly"}
                  ribbon={tierName}
                  seats={p.seat_limit >= 999 ? "Custom seats" : `${p.seat_limit} seats included`}
                  highlights={highlights}
                  cta={p.seat_limit >= 999 ? "Talk to sales" : "Get started"}
                  ctaTo={p.seat_limit >= 999 ? "/contact" : "/signup"}
                />
              );
            })}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          All prices in AUD, excl. GST. Annual billing saves 15%.
        </p>
      </section>

      {/* Credit packs */}
      <section id="credits" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <SectionHeader
          eyebrow="Credits"
          title="Top up when you need more"
          description="Generate more reports, scenarios and AI insights with on-demand credit packs. Never expires for active accounts."
          icon={<Zap className="h-5 w-5" />}
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {packs.slice(0, 8).map((pack: any) => {
            const meta = pack.metadata ?? {};
            const popular = !!meta.popular;
            return (
              <div
                key={pack.id}
                className={`group relative overflow-hidden rounded-2xl border bg-card/40 p-6 backdrop-blur transition-all hover:-translate-y-1 hover:border-primary/40 hover:bg-card/70 hover:shadow-[0_20px_60px_-20px] hover:shadow-primary/30 ${
                  popular ? "border-accent/50" : "border-border/50"
                }`}
              >
                {popular && (
                  <Badge className="absolute right-4 top-4 bg-accent text-accent-foreground">
                    Popular
                  </Badge>
                )}
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  {pack.name}
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
                    {pack.tokens.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">credits</span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {aud(pack.price_cents)}
                </div>
                {meta.best_for && (
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    {meta.best_for}
                  </p>
                )}
                <div className="mt-6 flex items-center text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Purchase <ArrowRight className="ml-1 h-3 w-3" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Modules / setup / reports */}
      <section id="addons" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <SectionHeader
          eyebrow="Build your stack"
          title="Modules, onboarding and report economics"
          description="Mix and match what your firm actually uses. All optional, all transparent."
          icon={<Puzzle className="h-5 w-5" />}
        />

        <Tabs defaultValue="addons" className="mt-12">
          <TabsList className="mx-auto grid w-full max-w-xl grid-cols-3 bg-card/60 backdrop-blur">
            <TabsTrigger value="addons">Add-ons</TabsTrigger>
            <TabsTrigger value="setup">Onboarding</TabsTrigger>
            <TabsTrigger value="reports">Report credits</TabsTrigger>
          </TabsList>

          <TabsContent value="addons" className="mt-8">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {addons.map((a: any) => (
                <Card
                  key={a.id}
                  className="border-border/50 bg-card/40 backdrop-blur transition-colors hover:border-primary/40"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{a.name}</CardTitle>
                      <Badge variant="outline" className="font-mono text-[9px] uppercase">
                        {a.category}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">{a.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-base font-semibold tracking-tight">
                      {range(a.price_min_cents, a.price_max_cents, a.currency)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        / {a.billing_period}
                      </span>
                    </div>
                    {a.included_in_plans?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {a.included_in_plans.map((pl: string) => (
                          <Badge
                            key={pl}
                            variant="secondary"
                            className="text-[10px] capitalize"
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

          <TabsContent value="setup" className="mt-8">
            <div className="grid gap-4 md:grid-cols-2">
              {setups.map((s: any) => (
                <Card
                  key={s.id}
                  className="border-border/50 bg-card/40 backdrop-blur"
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-primary" />
                        <CardTitle className="text-base">{s.name}</CardTitle>
                      </div>
                      <Badge variant="secondary">
                        {range(s.price_min_cents, s.price_max_cents, s.currency)}
                      </Badge>
                    </div>
                    <CardDescription>{s.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {(s.deliverables as string[] | null)?.map((d, i) => (
                        <li key={i} className="flex gap-2">
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

          <TabsContent value="reports" className="mt-8">
            <Card className="border-border/50 bg-card/40 backdrop-blur">
              <CardContent className="p-0">
                <div className="divide-y divide-border/40">
                  <div className="grid grid-cols-12 gap-2 px-6 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <div className="col-span-6">Report</div>
                    <div className="col-span-3">Category</div>
                    <div className="col-span-3 text-right">Credits</div>
                  </div>
                  {reports.map((r: any) => (
                    <div
                      key={r.id}
                      className="grid grid-cols-12 items-center gap-2 px-6 py-4 text-sm transition-colors hover:bg-surface-elevated/30"
                    >
                      <div className="col-span-6 font-medium">{r.name}</div>
                      <div className="col-span-3 text-xs uppercase tracking-wider text-muted-foreground">
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
            <p className="mt-3 text-xs text-muted-foreground">
              Credits are consumed only when a report is successfully generated.
            </p>
          </TabsContent>
        </Tabs>
      </section>

      {/* Trust strip */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-6 rounded-2xl border border-border/50 bg-gradient-to-br from-card/60 via-card/30 to-card/60 p-8 backdrop-blur md:grid-cols-3">
          <Trust icon={<ShieldCheck className="h-5 w-5" />} title="Enterprise security" body="SSO, audit logs, role-based access and isolated tenancy by default." />
          <Trust icon={<InfinityIcon className="h-5 w-5" />} title="Scales with you" body="Add seats, devices and credits the moment the team needs them." />
          <Trust icon={<Users className="h-5 w-5" />} title="Hands-on onboarding" body="A real human walks your team through setup, configuration and rollout." />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 mx-auto max-w-3xl px-6 pb-32">
        <SectionHeader
          eyebrow="FAQ"
          title="Questions, answered"
          icon={<FileText className="h-5 w-5" />}
        />
        <Accordion type="single" collapsible className="mt-8">
          <FaqItem q="How do credits work?" a="Every AI-generated report or scenario consumes credits based on its complexity. Each plan includes a monthly allowance; you can top up anytime with credit packs that never expire while your account is active." />
          <FaqItem q="Can I change plans later?" a="Absolutely. Upgrade, downgrade or change seat counts whenever your firm changes shape. Pro-rated billing applies on the next cycle." />
          <FaqItem q="What does onboarding include?" a="A dedicated specialist walks your team through configuration, brand setup, workflows and training. Larger packages include migration, integrations and white-label theming." />
          <FaqItem q="Do you offer annual billing?" a="Yes — flip the toggle at the top of the page for a 15% discount on annual prepayment. We also offer multi-year terms for Enterprise customers." />
          <FaqItem q="Is there a free trial?" a="Reach out through the Get started flow. We'll set up a sandbox environment so your team can road-test the platform with sample data." />
        </Accordion>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-32">
        <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-10 text-center md:p-16">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,theme(colors.primary/15),transparent_60%)]" />
          <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Ready when you are.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
            Spin up a workspace today, or book a walkthrough with our team to see
            it on your data.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="shadow-[0_0_40px_-10px] shadow-primary/60">
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline" className="border-border/60">
                Talk to sales
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/40 bg-background/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark small />
            <span>© {new Date().getFullYear()} Aurixa. All rights reserved.</span>
          </div>
          <div className="flex gap-6">
            <Link to="/" className="hover:text-foreground">Home</Link>
            <a href="#plans" className="hover:text-foreground">Plans</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- subcomponents ---------------- */

function PlanCard({
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
      className={`group relative flex flex-col overflow-hidden rounded-2xl border p-7 backdrop-blur transition-all duration-300 hover:-translate-y-1 ${
        featured
          ? "border-primary/60 bg-gradient-to-br from-primary/10 via-card/80 to-card/40 shadow-[0_30px_80px_-30px] shadow-primary/40"
          : "border-border/50 bg-card/40 hover:border-primary/40"
      }`}
    >
      {featured && (
        <>
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
          <Badge className="absolute right-5 top-5 border-0 bg-gradient-to-r from-primary to-accent text-primary-foreground">
            {ribbon}
          </Badge>
        </>
      )}

      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        {name}
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{tagline}</p>

      <div className="mt-6">
        <div className="flex items-baseline gap-1">
          <span className="bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-4xl font-semibold tracking-tight text-transparent">
            {aud(price)}
          </span>
          {showRange && priceMax > price && (
            <span className="text-sm text-muted-foreground">
              – {aud(priceMax)}
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          AUD / month · ex GST
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-xs font-medium text-foreground/80">
        {seats}
      </div>

      <ul className="mt-6 flex-1 space-y-3 text-sm">
        {highlights.map((h, i) => (
          <li key={i} className="flex gap-2">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? "text-accent" : "text-primary"}`} />
            <span className="text-muted-foreground">{h}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <Link to={ctaTo}>
          <Button
            className={`w-full ${
              featured
                ? "bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-[0_0_30px_-8px] shadow-primary/60"
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
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground backdrop-blur">
        {icon}
        {eyebrow}
      </div>
      <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-muted-foreground md:text-base">
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
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <h4 className="font-semibold">{title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <AccordionItem value={q} className="border-border/40">
      <AccordionTrigger className="text-left text-base font-medium hover:text-primary">
        {q}
      </AccordionTrigger>
      <AccordionContent className="text-sm text-muted-foreground">
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
      {/* radial glows */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute top-[40%] right-[-10%] h-[500px] w-[500px] rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] h-[500px] w-[500px] rounded-full bg-primary/10 blur-[140px]" />
      </div>
      {/* grid */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />
    </>
  );
}
