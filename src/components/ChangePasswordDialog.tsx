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

const ChangePasswordDialog = ({ targetUserId, targetUserName, trigger }: ChangePasswordDialogProps) => {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setLoading(true);
    try {
      const res = await supabase.functions.invoke("update-password", {
        body: {
          target_user_id: targetUserId,
          new_password: newPassword,
        },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("Contraseña actualizada correctamente");
      setOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar contraseña");
    } finally {
      setLoading(false);
    }
  };

  const title = targetUserName
    ? `Cambiar contraseña de ${targetUserName}`
    : "Cambiar mi contraseña";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <KeyRound className="h-3.5 w-3.5" />
            Cambiar contraseña
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-sm">Nueva contraseña</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              required
              minLength={6}
              className="h-10 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-sm">Confirmar contraseña</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repetir contraseña"
              required
              minLength={6}
              className="h-10 rounded-xl"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-xl">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar contraseña"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;
