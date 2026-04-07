import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Building2, Camera, Check, Loader2, Shield } from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

interface BranchAssignment {
  branch_id: string;
  branch_name: string;
  role_code: string;
  role_name: string;
}

interface UserRow {
  id: string;
  full_name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  active_branch_id: string | null;
  avatar_url?: string | null;
  is_protected_superadmin?: boolean;
  global_roles: { code: string; name: string }[];
  branch_assignments: BranchAssignment[];
}

interface EditUserDialogProps {
  user: UserRow;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  branchesMap: Record<string, string>;
  catalog: {
    branches: { id: string; name: string }[];
    branch_roles: { id: string; code: string; name: string }[];
    global_roles: { id: string; code: string; name: string }[];
  } | undefined;
}

const EditUserDialog = ({ user, open, onClose, onRefresh, branchesMap, catalog }: EditUserDialogProps) => {
  const { profile, refreshProfile } = useAuth();
  const isProtected = Boolean(user.is_protected_superadmin);
  const isAdmin = user.global_roles.some((r) => r.code === "administrador");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar_url ?? null);
  const [editValues, setEditValues] = useState({
    full_name: user.full_name,
    username: user.username,
  });

  const currentUserType = isAdmin
    ? "administrador"
    : user.branch_assignments.some((a) => a.role_code === "supervisor")
      ? "supervisor"
      : "usuario_operativo";

  const uniqueBranchAssignments = Array.from(
    new Map(user.branch_assignments.map((a) => [a.branch_id, a])).values(),
  );
  const initialBranchId = user.active_branch_id ?? uniqueBranchAssignments[0]?.branch_id ?? "";

  const [selectedUserType, setSelectedUserType] = useState(currentUserType);
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);

  const isNewAdmin = selectedUserType === "administrador";

  const saveUser = useMutation({
    mutationFn: async () => {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: editValues.full_name, username: editValues.username })
        .eq("id", user.id);
      if (profileError) throw profileError;

      if (selectedUserType === "administrador") {
        if (!isAdmin) {
          const { error } = await supabase.rpc("assign_user_global_role" as never, {
            p_target_user_id: user.id,
            p_role_code: "administrador",
          } as never);
          if (error) throw error;
        }

        for (const assignment of user.branch_assignments) {
          const { error } = await supabase.rpc("remove_user_branch_role" as never, {
            p_target_user_id: user.id,
            p_branch_id: assignment.branch_id,
            p_role_code: assignment.role_code,
            p_reason: "Limpiar asignaciones de sucursal al convertir en administrador",
          } as never);
          if (error) throw error;
        }

        return;
      }

      if (!selectedBranchId) {
        throw new Error("Selecciona una sucursal para este usuario.");
      }

      if (isAdmin) {
        const { error } = await supabase.rpc("remove_user_global_role" as never, {
          p_target_user_id: user.id,
          p_role_code: "administrador",
        } as never);
        if (error) throw error;
      }

      for (const assignment of user.branch_assignments) {
        const { error } = await supabase.rpc("remove_user_branch_role" as never, {
          p_target_user_id: user.id,
          p_branch_id: assignment.branch_id,
          p_role_code: assignment.role_code,
          p_reason: "Reemplazo de asignacion unica por sucursal",
        } as never);
        if (error) throw error;
      }

      const { error: assignError } = await supabase.rpc("assign_user_branch_role" as never, {
        p_target_user_id: user.id,
        p_branch_id: selectedBranchId,
        p_role_code: selectedUserType,
        p_reason: "Asignacion unica desde administracion",
      } as never);
      if (assignError) throw assignError;

      const { error: activeBranchError } = await supabase.rpc("set_user_active_branch", {
        p_target_user_id: user.id,
        p_new_branch_id: selectedBranchId,
        p_reason: "Sucursal unica desde administracion",
      });
      if (activeBranchError) throw activeBranchError;
    },
    onSuccess: () => {
      onRefresh();
      if (user.id === profile?.id) {
        void refreshProfile();
      }
      onClose();
      toast.success("Usuario actualizado");
    },
    onError: (e: any) => toast.error(e.message || "Error al actualizar"),
  });

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("La imagen no puede superar los 2 MB");
      return;
    }

    setUploadingAvatar(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await (supabase.from("profiles") as any)
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);
      if (updateError) throw updateError;

      setAvatarPreview(publicUrl);
      onRefresh();
      if (user.id === profile?.id) {
        void refreshProfile();
      }
      toast.success("Foto actualizada");
    } catch (err: any) {
      toast.error(err.message || "No se pudo subir la foto");
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-0">
        <div className="relative flex items-center gap-5 border-b border-slate-100 bg-gradient-to-r from-primary/5 to-transparent p-6">
          <div
            className="group relative shrink-0 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            title="Cambiar foto"
          >
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt={user.full_name}
                className="h-16 w-16 rounded-full object-cover ring-4 ring-primary/20 transition-opacity group-hover:opacity-70"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-black text-primary ring-4 ring-primary/10 transition-opacity group-hover:opacity-70">
                {user.full_name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              {uploadingAvatar ? (
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              ) : (
                <Camera className="h-5 w-5 text-white" />
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg font-black text-slate-900">{user.full_name}</DialogTitle>
            <p className="text-sm text-muted-foreground">@{user.username}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>

          <ChangePasswordDialog
            targetUserId={user.id}
            targetUserName={user.full_name}
            targetUserEmail={user.email ?? null}
            targetUsername={user.username}
            trigger={
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5 rounded-xl text-xs font-semibold">
                Cambiar contrasena
              </Button>
            }
          />
        </div>

        <div className="space-y-6 p-6">
          <div className="space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Datos del perfil</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre Completo</label>
                <Input
                  value={editValues.full_name}
                  onChange={(e) => setEditValues({ ...editValues, full_name: e.target.value })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre de Usuario</label>
                <Input
                  value={editValues.username}
                  onChange={(e) => setEditValues({ ...editValues, username: e.target.value })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tipo de usuario</span>
              </div>
              <Select
                value={selectedUserType}
                onValueChange={(val) => {
                  setSelectedUserType(val);
                  if (val === "administrador") {
                    setSelectedBranchId("");
                  }
                  if (val !== "administrador" && !selectedBranchId) {
                    setSelectedBranchId(initialBranchId || catalog?.branches[0]?.id || "");
                  }
                }}
                disabled={isProtected || saveUser.isPending}
              >
                <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="administrador">Administrador General</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="usuario_operativo">Usuario operativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!isNewAdmin && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sucursal asignada</span>
                </div>
                <Select
                  value={selectedBranchId || undefined}
                  onValueChange={setSelectedBranchId}
                  disabled={isProtected || saveUser.isPending}
                >
                  <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white">
                    <SelectValue placeholder="Seleccionar sucursal" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {(catalog?.branches ?? []).map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branchesMap[branch.id] ?? branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {!isProtected && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white/95 px-6 py-4 backdrop-blur-sm">
            <Button
              size="sm"
              variant="ghost"
              className="h-9 rounded-xl px-5 text-xs font-semibold text-slate-600"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => saveUser.mutate()}
              disabled={saveUser.isPending || (!isNewAdmin && !selectedBranchId)}
              className="h-9 rounded-xl px-6 text-xs font-bold shadow-sm"
            >
              {saveUser.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-2 h-3.5 w-3.5" />
              )}
              Guardar cambios
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditUserDialog;
