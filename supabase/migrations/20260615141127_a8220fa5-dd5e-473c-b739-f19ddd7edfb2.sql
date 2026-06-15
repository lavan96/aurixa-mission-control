ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'device_limit_reached';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'device_registered';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'device_released';