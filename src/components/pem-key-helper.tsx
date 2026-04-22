import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Copy, ArrowRight, Key, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import forge from "node-forge";

type KeyStatus = "idle" | "pkcs1" | "pkcs8" | "invalid";

export function PemKeyHelper() {
  const [input, setInput] = useState("");
  const [converted, setConverted] = useState("");
  const [status, setStatus] = useState<KeyStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const detect = (pem: string): KeyStatus => {
    const trimmed = pem.trim();
    if (trimmed.includes("-----BEGIN RSA PRIVATE KEY-----")) return "pkcs1";
    if (trimmed.includes("-----BEGIN PRIVATE KEY-----")) return "pkcs8";
    if (trimmed.includes("-----BEGIN")) return "invalid";
    return "idle";
  };

  const handleInput = (val: string) => {
    setInput(val);
    setConverted("");
    setError(null);
    setCopied(false);
    setStatus(detect(val));
  };

  const convert = () => {
    setError(null);
    try {
      const privateKey = forge.pki.privateKeyFromPem(input.trim());
      const pkcs8Pem = forge.pki.privateKeyToPem(privateKey);

      // node-forge's privateKeyToPem outputs RSA PRIVATE KEY (PKCS#1).
      // We need to convert to PKCS#8 using privateKeyInfoToPem.
      const asn1 = forge.pki.privateKeyToAsn1(privateKey);
      const privateKeyInfo = forge.pki.wrapRsaPrivateKey(asn1);
      const pkcs8 = forge.pki.privateKeyInfoToPem(privateKeyInfo);

      setConverted(pkcs8);
      setStatus("pkcs8");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse key");
      setStatus("invalid");
    }
  };

  const verify = () => {
    setError(null);
    try {
      const trimmed = (converted || input).trim();
      if (!trimmed.includes("-----BEGIN PRIVATE KEY-----")) {
        setError("Key is not in PKCS#8 format. It must start with -----BEGIN PRIVATE KEY-----");
        return;
      }
      // Try to parse it back
      const info = forge.pki.pemToDer(trimmed);
      if (info.length() < 100) {
        setError("Key appears too short to be valid.");
        return;
      }
      setStatus("pkcs8");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Key verification failed");
      setStatus("invalid");
    }
  };

  const copyToClipboard = async () => {
    const text = converted || input;
    await navigator.clipboard.writeText(text.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-border/60 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-mono tracking-wide">
          <Key className="h-4 w-4 text-primary" />
          PRIVATE KEY CONVERTER &amp; VALIDATOR
        </CardTitle>
        <CardDescription className="text-xs">
          GitHub App keys are often downloaded in <strong>PKCS#1</strong> format
          (<code className="rounded bg-muted px-1">BEGIN RSA PRIVATE KEY</code>). Our system
          requires <strong>PKCS#8</strong> format
          (<code className="rounded bg-muted px-1">BEGIN PRIVATE KEY</code>). Convert and verify
          here before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* OpenSSL command reference */}
        <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" />
            OpenSSL command (alternative)
          </div>
          <pre className="overflow-x-auto rounded bg-background/80 p-2 font-mono text-[11px] leading-relaxed text-foreground/90 select-all">
{`openssl pkcs8 -topk8 -inform PEM \\
  -outform PEM -nocrypt \\
  -in your-github-app-key.pem \\
  -out converted-key.pem`}
          </pre>
          <p className="text-[11px] text-muted-foreground">
            Then paste the contents of <code className="rounded bg-muted px-0.5">converted-key.pem</code> into
            the secret field — or use the converter below.
          </p>
        </div>

        {/* Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Paste your private key (PKCS#1 or PKCS#8)
          </label>
          <Textarea
            rows={6}
            className="font-mono text-[11px] leading-relaxed"
            placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;MIIEpAIBAAKCAQEA...&#10;-----END RSA PRIVATE KEY-----"
            value={input}
            onChange={(e) => handleInput(e.target.value)}
          />
          {status !== "idle" && (
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] uppercase",
                  status === "pkcs1" && "border-warning/40 text-warning",
                  status === "pkcs8" && "border-success/40 text-success",
                  status === "invalid" && "border-destructive/40 text-destructive",
                )}
              >
                {status === "pkcs1" && "PKCS#1 detected — needs conversion"}
                {status === "pkcs8" && "PKCS#8 format ✓"}
                {status === "invalid" && "Unrecognised format"}
              </Badge>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {status === "pkcs1" && (
            <Button size="sm" onClick={convert}>
              <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
              Convert to PKCS#8
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={verify}
            disabled={!input.trim() && !converted.trim()}
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Verify key
          </Button>
        </div>

        {/* Converted output */}
        {converted && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-success">
              Converted key (PKCS#8) — copy this into the secret
            </label>
            <Textarea
              rows={6}
              readOnly
              className="font-mono text-[11px] leading-relaxed border-success/30 bg-success/5"
              value={converted}
            />
            <Button size="sm" variant="outline" onClick={copyToClipboard}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy to clipboard"}
            </Button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Verification success */}
        {status === "pkcs8" && !error && (converted || input.includes("BEGIN PRIVATE KEY")) && (
          <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-xs text-success">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Key is in the correct PKCS#8 format and ready to be saved as a secret.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
