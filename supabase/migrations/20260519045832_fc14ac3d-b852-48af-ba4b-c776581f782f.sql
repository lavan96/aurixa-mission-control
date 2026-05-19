
-- Per-seat role pricing tiers
CREATE TABLE public.seat_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_min_cents integer NOT NULL DEFAULT 0,
  price_max_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'AUD',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.seat_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read seat_roles" ON public.seat_roles FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Admins write seat_roles" ON public.seat_roles FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER seat_roles_updated BEFORE UPDATE ON public.seat_roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add-on modules catalog
CREATE TABLE public.addon_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'addon',
  description text,
  price_min_cents integer NOT NULL DEFAULT 0,
  price_max_cents integer NOT NULL DEFAULT 0,
  billing_period text NOT NULL DEFAULT 'monthly',
  currency text NOT NULL DEFAULT 'AUD',
  included_in_plans text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.addon_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read addon_modules" ON public.addon_modules FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Admins write addon_modules" ON public.addon_modules FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER addon_modules_updated BEFORE UPDATE ON public.addon_modules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Setup & onboarding packages
CREATE TABLE public.setup_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_min_cents integer NOT NULL DEFAULT 0,
  price_max_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'AUD',
  applies_to_plans text[] NOT NULL DEFAULT '{}'::text[],
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.setup_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read setup_packages" ON public.setup_packages FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Admins write setup_packages" ON public.setup_packages FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER setup_packages_updated BEFORE UPDATE ON public.setup_packages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Per-report-type credit costs
CREATE TABLE public.report_credit_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'report',
  description text,
  credit_cost integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_credit_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read report_credit_costs" ON public.report_credit_costs FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Admins write report_credit_costs" ON public.report_credit_costs FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER report_credit_costs_updated BEFORE UPDATE ON public.report_credit_costs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
