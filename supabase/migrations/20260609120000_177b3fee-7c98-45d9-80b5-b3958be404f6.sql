-- Close a schema/type-drift gap: the notifications UI already exposes filters for
-- device lifecycle events, but the database `notification_kind` enum was missing
-- the matching values. Add them so the frontend Kind union matches the DB enum.
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'device_limit_reached';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'device_registered';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'device_released';
