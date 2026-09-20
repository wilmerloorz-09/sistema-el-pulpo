import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";

type LoginBranch = {
  id: string;
  name: string;
};

const LOGIN_BRANCH_STORAGE_KEY = "loginBranchId";

const getLoginErrorMessage = (rawMessage?: string) => {
  const message = rawMessage?.trim() || "No se pudo iniciar sesion.";
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (
    normalized.includes("credenciales invalidas") ||
    normalized.includes("invalid login") ||
    normalized.includes("invalid credentials")
  ) {
    return "No se puede ingresar porque el correo/usuario/alias o la contrasena son incorrectos. Revisa los datos e intenta nuevamente.";
  }

  if (
    normalized.includes("saturado")
    || normalized.includes("validando identificador")
    || normalized.includes("503")
    || normalized.includes("timeout")
  ) {
    return "El servidor esta saturado. Espera 15–30 segundos e intenta de nuevo. Si sigue fallando, ingresa con el correo (email) del usuario en lugar del username.";
  }

  if (normalized.includes("identificador") && normalized.includes("contrasena")) {
    return "No se puede ingresar porque falta el correo/usuario/alias o la contrasena.";
  }

  if (normalized.includes("sucursal")) {
    return message;
  }

  return message;
};

const Login = () => {
  const { signIn, user, loading: authLoading } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [branchId, setBranchId] = useState(() => localStorage.getItem(LOGIN_BRANCH_STORAGE_KEY) ?? "");
  const [branches, setBranches] = useState<LoginBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadBranches = async () => {
      setBranchesLoading(true);
      setBranchesError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc("list_login_branches" as any);
        if (rpcError) throw rpcError;

        const rows = ((data ?? []) as LoginBranch[])
          .filter((row) => row?.id && row?.name)
          .map((row) => ({ id: String(row.id), name: String(row.name) }));

        if (cancelled) return;
        setBranches(rows);

        const remembered = localStorage.getItem(LOGIN_BRANCH_STORAGE_KEY);
        if (remembered && rows.some((row) => row.id === remembered)) {
          setBranchId(remembered);
        } else if (rows.length === 1) {
          setBranchId(rows[0].id);
        } else if (remembered) {
          setBranchId("");
        }
      } catch (err: any) {
        if (cancelled) return;
        setBranches([]);
        setBranchesError(err?.message || "No se pudieron cargar las sucursales.");
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    };

    void loadBranches();
    return () => {
      cancelled = true;
    };
  }, []);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signIn(identifier, password, branchId || null);
    } catch (err: any) {
      const msg = getLoginErrorMessage(err.message || "Error al iniciar sesion");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.14),transparent_26%)]" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="surface-glow w-full max-w-md space-y-8 p-8"
      >
        <div className="text-center space-y-2">
          <img
            src="/logo.png"
            alt="El Pulpo"
            className="mx-auto h-28 w-28 rounded-full object-cover shadow-[0_20px_45px_-30px_rgba(249,115,22,0.75)]"
          />
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-black text-foreground">El Pulpo POS</h1>
            <p className="text-sm text-muted-foreground">Sistema POS</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="identifier" className="text-sm font-medium">
              Correo, usuario o alias
            </Label>
            <Input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="usuario@elpulpo.com, admin o JuanP"
              required
              autoComplete="username"
              className="h-12 text-base"
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
              className="h-12 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Sucursal</Label>
            <Select
              value={branchId || undefined}
              onValueChange={setBranchId}
              disabled={branchesLoading || branches.length === 0}
            >
              <SelectTrigger className="h-12 rounded-xl text-base">
                <SelectValue
                  placeholder={
                    branchesLoading
                      ? "Cargando sucursales..."
                      : branchesError
                        ? "No se pudieron cargar"
                        : "Tu sucursal habilitada (opcional)"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {branchesError ? (
              <p className="text-xs text-destructive">{branchesError}</p>
            ) : null}
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full gap-2 font-display text-base font-semibold"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
              <>
                <LogIn className="h-5 w-5" />
                Iniciar sesion
              </>
            )}
          </Button>
        </form>
      </motion.div>

      <AlertDialog open={Boolean(error)} onOpenChange={(open) => !open && setError(null)}>
        <AlertDialogContent className="max-w-sm rounded-[24px] border-orange-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
              <AlertCircle className="h-5 w-5 text-destructive" />
              No se puede ingresar
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-foreground/80">
              {error}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setError(null)}>Aceptar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Login;
