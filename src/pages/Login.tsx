import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

const Login = () => {
  const { signIn, user, loading: authLoading } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const supportsPasskey = browserSupportsWebAuthn();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (user) return <Navigate to="/mesas" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(identifier, password);
    } catch (err: any) {
      toast.error(err.message || "Error al iniciar sesion");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    try {
      const { data: options, error: optErr } = await supabase.functions.invoke("webauthn-authenticate", { body: { action: "options" } });
      if (optErr) throw new Error(optErr.message);

      const { challengeId, ...optionsJSON } = options;
      const assertion = await startAuthentication({ optionsJSON });

      const { data: result, error: verErr } = await supabase.functions.invoke("webauthn-authenticate", {
        body: { action: "verify", assertion, challengeId },
      });
      if (verErr) throw new Error(verErr.message);

      if (result.verified && result.token_hash) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: result.token_hash,
          type: "magiclink",
        });
        if (otpError) throw otpError;
        toast.success("Sesion iniciada con huella");
      } else {
        toast.error("Verificacion fallida");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        toast.error("Operacion cancelada");
      } else {
        toast.error(err.message || "Error al autenticar con huella");
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <span className="text-2xl font-bold text-primary-foreground">EP</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">El Pulpo</h1>
          <p className="text-sm text-muted-foreground">Sistema POS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="identifier" className="text-sm font-medium">
              Correo o usuario
            </Label>
            <Input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="usuario@elpulpo.com o admin"
              required
              autoComplete="username"
              className="h-12 rounded-xl bg-card text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              Contrasena
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              required
              autoComplete="current-password"
              className="h-12 rounded-xl bg-card text-base"
            />
          </div>

          <Button type="submit" disabled={loading} className="h-12 w-full rounded-xl font-display text-base font-semibold">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Iniciar sesion"}
          </Button>
        </form>

        {supportsPasskey && (
          <div className="space-y-3">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">o</span>
              </div>
            </div>
            <Button variant="outline" onClick={handlePasskeyLogin} disabled={passkeyLoading} className="h-12 w-full rounded-xl text-base gap-2">
              {passkeyLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Fingerprint className="h-5 w-5" />
                  Ingresar con huella
                </>
              )}
            </Button>
          </div>
        )}
</motion.div>
    </div>
  );
};

export default Login;
