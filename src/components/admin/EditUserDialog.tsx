import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2,
  Check,
  Camera,
  Loader2,
  Plus,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

  // Derivar el tipo actual del usuario
  // - admin global: tiene rol 'administrador' (GLOBAL)
  // - supervisor: NO tiene rol global (su rol es BRANCH 'supervisor')
  // - usuario operativo: NO tiene rol global (su rol es BRANCH 'usuario_operativo')
  const currentUserType = isAdmin
    ? "administrador"
    : user.branch_assignments.some((a) => a.role_code === "supervisor")
      ? "supervisor"
      : "usuario_operativo";

  const [selectedUserType, setSelectedUserType] = useState(currentUserType);

  const [newAssignmentBranchId, setNewAssignmentBranchId] = useState("");
  const [newAssignmentRoleCode, setNewAssignmentRoleCode] = useState("");
  const [showAddAssignment, setShowAddAssignment] = useState(false);

  const isNewAdmin = selectedUserType === "administrador";

  const uniqueBranchAssignments = Array.from(
    new Map(user.branch_assignments.map((a) => [a.branch_id, a])).values()
  );

  const assignedRoleCodesForSelectedBranch = user.branch_assignments
    .filter((a) => a.branch_id === newAssignmentBranchId)
    .map((a) => a.role_code);

  /* ── Mutations ── */
  const updateProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: editValues.full_name, username: editValues.username })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      onRefresh();
      if (user.id === profile?.id) {
        void refreshProfile();
      }
      onClose();
      toast.success("Perfil actualizado");
    },
    onError: (e: any) => toast.error(e.message || "Error al actualizar"),
  });

  const changeUserType = useMutation({
    mutationFn: async (newType: string) => {
      if (newType === "administrador") {
        // Asignar como admin global
        const { error } = await supabase.rpc("assign_user_global_role" as never, {
          p_target_user_id: user.id,
          p_role_code: "administrador",
        } as never);
        if (error) throw error;
      } else {
        // Quitar admin global si lo tenía
        if (user.global_roles.some((r) => r.code === "administrador")) {
          const { error } = await supabase.rpc("remove_user_global_role" as never, {
            p_target_user_id: user.id,
            p_role_code: "administrador",
          } as never);
          if (error) throw error;
        }
        // El rol de sucursal (supervisor / usuario_operativo) se aplica
        // actualizando todas las asignaciones existentes de esta persona
        if (user.branch_assignments.length > 0) {
          for (const assignment of user.branch_assignments) {
            // Quitar asignación vieja
            await supabase.rpc("remove_user_branch_role" as never, {
              p_target_user_id: user.id,
              p_branch_id: assignment.branch_id,
              p_role_code: assignment.role_code,
              p_reason: "Cambio de tipo de usuario",
            } as never);
            // Poner nueva
            await supabase.rpc("assign_user_branch_role" as never, {
              p_target_user_id: user.id,
              p_branch_id: assignment.branch_id,
              p_role_code: newType,
              p_reason: "Cambio de tipo de usuario",
            } as never);
          }
        }
      }
    },
    onSuccess: () => { onRefresh(); toast.success("Tipo de usuario actualizado"); },
    onError: (e: any) => toast.error(e.message),
  });

  const setActiveBranch = useMutation({
    mutationFn: async (branch_id: string) => {
      const { error } = await supabase.rpc("set_user_active_branch", {
        p_target_user_id: user.id,
        p_new_branch_id: branch_id,
        p_reason: "Cambio de sucursal activa desde administracion",
      });
      if (error) throw error;
    },
    onSuccess: () => { onRefresh(); toast.success("Sucursal activa actualizada"); },
    onError: (e: any) => toast.error(e.message),
  });

  const saveAssignment = useMutation({
    mutationFn: async () => {
      // Buscar en el catálogo el rol de sucursal que coincida con el tipo de usuario.
      // Los códigos de rol global y de sucursal pueden ser los mismos o distintos.
      const branchRoleCode =
        catalog?.branch_roles.find((r) => r.code === selectedUserType)?.code ??
        catalog?.branch_roles[0]?.code;

      if (!branchRoleCode) throw new Error("No hay roles de sucursal disponibles");

      const { error } = await supabase.rpc("assign_user_branch_role" as never, {
        p_target_user_id: user.id,
        p_branch_id: newAssignmentBranchId,
        p_role_code: branchRoleCode,
        p_reason: "Asignacion desde administracion",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      onRefresh();
      setShowAddAssignment(false);
      setNewAssignmentBranchId("");
      setNewAssignmentRoleCode("");
      toast.success("Asignación guardada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeAssignment = useMutation({
    mutationFn: async ({ branch_id, role_code }: { branch_id: string; role_code: string }) => {
      const { error } = await supabase.rpc("remove_user_branch_role" as never, {
        p_target_user_id: user.id,
        p_branch_id: branch_id,
        p_role_code: role_code,
        p_reason: "Remocion desde administracion",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { onRefresh(); toast.success("Asignación removida"); },
    onError: (e: any) => toast.error(e.message),
  });

  /* ── Avatar Upload ── */
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
        {/* Header con avatar */}
        <div className="relative flex items-center gap-5 border-b border-slate-100 bg-gradient-to-r from-primary/5 to-transparent p-6">
          {/* Avatar clickeable */}
          <div
            className="relative shrink-0 cursor-pointer group"
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

          <div className="flex-1 min-w-0">
            <DialogTitle className="truncate text-lg font-black text-slate-900">
              {user.full_name}
            </DialogTitle>
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
                Cambiar contraseña
              </Button>
            }
          />
        </div>

        <div className="space-y-6 p-6">
          {/* Datos básicos */}
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

          {/* Tipo de usuario + Sucursal activa */}
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
                  changeUserType.mutate(val);
                }}
                disabled={isProtected || changeUserType.isPending}
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
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sucursal activa</span>
                </div>
                <Select
                  value={user.active_branch_id ?? undefined}
                  onValueChange={(v) => setActiveBranch.mutate(v)}
                  disabled={isProtected || uniqueBranchAssignments.length === 0}
                >
                  <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white">
                    <SelectValue placeholder="Seleccionar sucursal activa" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {uniqueBranchAssignments.map((a) => (
                      <SelectItem key={a.branch_id} value={a.branch_id}>
                        {branchesMap[a.branch_id] ?? a.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Asignaciones de sucursal */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Asignaciones por Sucursal</h4>
              </div>
              {!isProtected && !showAddAssignment && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 rounded-lg border-primary/20 bg-primary/5 px-3 text-[11px] font-bold text-primary hover:bg-primary/10"
                  onClick={() => setShowAddAssignment(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Agregar
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {user.branch_assignments.map((a) => (
                <div
                  key={`${a.branch_id}-${a.role_code}`}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2",
                    user.active_branch_id === a.branch_id
                      ? "border-primary/30 bg-primary/5"
                      : "border-slate-200 bg-white"
                  )}
                >
                  <span className="text-xs font-semibold text-slate-800">{a.branch_name}</span>
                  <button
                    disabled={isProtected}
                    onClick={() => removeAssignment.mutate({ branch_id: a.branch_id, role_code: a.role_code })}
                    className="ml-1 rounded-full p-1 text-slate-400 hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {user.branch_assignments.length === 0 && (
                <p className="text-xs text-slate-400 italic">Sin asignaciones de sucursal</p>
              )}
            </div>

            {showAddAssignment && (() => {
              // Sucursales que aún no tienen asignación
              const assignedBranchIds = new Set(user.branch_assignments.map((a) => a.branch_id));
              const availableBranches = (catalog?.branches ?? []).filter((b) => !assignedBranchIds.has(b.id));
              return (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 animate-in fade-in zoom-in duration-200">
                  {availableBranches.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">El usuario ya está asignado a todas las sucursales disponibles.</p>
                  ) : (
                    <Select
                      value={newAssignmentBranchId || undefined}
                      onValueChange={setNewAssignmentBranchId}
                    >
                      <SelectTrigger className="h-10 w-64 rounded-xl border-slate-200 bg-white text-sm">
                        <SelectValue placeholder="Seleccionar sucursal..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableBranches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-10 w-10 rounded-xl p-0"
                      onClick={() => saveAssignment.mutate()}
                      disabled={!newAssignmentBranchId || availableBranches.length === 0 || saveAssignment.isPending}
                    >
                      {saveAssignment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-10 w-10 rounded-xl p-0 text-muted-foreground" onClick={() => { setShowAddAssignment(false); setNewAssignmentBranchId(""); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Footer con acciones principales */}
        {!isProtected && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white/95 backdrop-blur-sm px-6 py-4">
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
              onClick={() => updateProfile.mutate()}
              disabled={updateProfile.isPending}
              className="h-9 rounded-xl px-6 text-xs font-bold shadow-sm"
            >
              {updateProfile.isPending
                ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                : <Check className="mr-2 h-3.5 w-3.5" />}
              Guardar cambios
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditUserDialog;
