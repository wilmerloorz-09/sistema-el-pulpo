import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";

interface ChangePasswordDialogProps {
  /** If provided, admin is changing another user's password */
  targetUserId?: string;
  targetUserName?: string;
  trigger?: React.ReactNode;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const ChangePasswordDialog = ({ targetUserId, targetUserName, trigger }: ChangePasswordDialogProps) => {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const getAccessToken = async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw new Error("No se pudo obtener la sesion actual");
    }

    let accessToken = sessionData.session?.access_token ?? null;
    if (accessToken) {
      return accessToken;
    }

    const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshedData.session?.access_token) {
      throw new Error("No se pudo renovar la sesion actual");
    }

    return refreshedData.session.access_token;
  };

  const callUpdatePassword = async (accessToken: string) => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/update-password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_user_id: targetUserId,
        new_password: newPassword,
      }),
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { response, payload };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Las contrasenas no coinciden");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("La contrasena debe tener al menos 6 caracteres");
      return;
    }

    setLoading(true);
    try {
      let accessToken = await getAccessToken();
      let { response, payload } = await callUpdatePassword(accessToken);

      if (response.status === 401) {
        const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshedData.session?.access_token) {
          throw new Error(payload?.error || "La sesion expiro. Inicia sesion nuevamente.");
        }

        accessToken = refreshedData.session.access_token;
        ({ response, payload } = await callUpdatePassword(accessToken));
      }

      if (!response.ok) {
        throw new Error(payload?.error || `Error HTTP ${response.status}`);
      }

      if (payload?.error) {
        throw new Error(String(payload.error));
      }

      toast.success("Contrasena actualizada correctamente");
      setOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      const message = String(err?.message || "");
      const isUnavailable = message.includes("Failed to fetch");
      toast.error(
        isUnavailable
          ? "La funcion de cambio de contrasena no esta disponible. Debes desplegar update-password en Supabase."
          : message || "Error al cambiar contrasena",
      );
    } finally {
      setLoading(false);
    }
  };

  const title = targetUserName
    ? `Cambiar contrasena de ${targetUserName}`
    : "Cambiar mi contrasena";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <KeyRound className="h-3.5 w-3.5" />
            Cambiar contrasena
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-sm">Nueva contrasena</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimo 6 caracteres"
              required
              minLength={6}
              className="h-10 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-sm">Confirmar contrasena</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repetir contrasena"
              required
              minLength={6}
              className="h-10 rounded-xl"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-xl">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar contrasena"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;
