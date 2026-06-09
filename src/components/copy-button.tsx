import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  value: string;
  label?: string;
  className?: string;
  size?: "icon" | "xs" | "sm";
  /** Show the value next to the icon (truncated). */
  showValue?: boolean;
  /** Max chars to show when showValue is true. */
  truncate?: number;
};

export function CopyButton({
  value,
  label,
  className,
  size = "icon",
  showValue = false,
  truncate = 16,
}: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`Copied ${label ?? "to clipboard"}`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not access clipboard");
    }
  };

  const display =
    showValue && value ? (value.length > truncate ? `${value.slice(0, truncate)}…` : value) : null;

  if (size === "icon") {
    return (
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label ?? "value"}`}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onCopy}
      className={cn(
        "h-7 gap-1.5 px-2 font-mono text-[11px]",
        size === "xs" && "h-6 px-1.5 text-[10px]",
        className,
      )}
      aria-label={`Copy ${label ?? "value"}`}
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      {display ?? label ?? "Copy"}
    </Button>
  );
}
