import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Building2, Camera, Check, KeyRound, Loader2, Shield } from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { resolveRoleCodeFromCatalog } from "./userRoleUtils";
import { getUserAlias, getUserRealName } from "@/lib/userDisplay";

interface BranchAssignment {
  branch_id: string;
  branch_name: string;
  role_code: string;
  role_name: string;
}

interface UserRow {
  id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  username: string;
  alias?: string;
  email?: string | null;
  identity_number?: string | null;
  home_address?: string | null;
  phone?: string | null;
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

const USERNAME_PATTERN = /^[A-Za-z0-9]+$/;
const NAME_PATTERN = /^[\p{L}\s]+$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEN_DIGIT_PATTERN = /^\d{10}$/;
const NO_BRANCH_VALUE = "__sin_sucursal__";

const EditUserDialog = ({ user, open, onClose, onRefresh, branchesMap, catalog }: EditUserDialogProps) => {
  const { profile, refreshProfile } = useAuth();
  const isProtected = Boolean(user.is_protected_superadmin);
  const isAdmin = user.global_roles.some((r) => r.code === "administrador");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar_url ?? null);
  const fallbackNameParts = user.full_name.trim().split(/\s+/).filter(Boolean);
  const [editValues, setEditValues] = useState({
    first_name: user.first_name ?? (fallbackNameParts.length > 1 ? fallbackNameParts.slice(0, -1).join(" ") : user.full_name),
    last_name: user.last_name ?? (fallbackNameParts.length > 1 ? fallbackNameParts.slice(-1).join(" ") : ""),
    username: user.username,
    alias: user.alias ?? user.username,
    identity_number: user.identity_number ?? "",
    home_address: user.home_address ?? "",
    phone: user.phone ?? "",
  });

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleClose = () => {
    setErrorMsg(null);
    onClose();
  };

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
  const displayName = getUserRealName(user) || user.first_name || user.full_name || getUserAlias(user);

  const isNewAdmin = selectedUserType === "administrador";
  const isNewSupervisor = selectedUserType === "supervisor";
  const usernameValid = USERNAME_PATTERN.test(editValues.username);
  const aliasValid = USERNAME_PATTERN.test(editValues.alias);
  const firstNameValid = NAME_PATTERN.test(editValues.first_name.trim());
  const lastNameValid = NAME_PATTERN.test(editValues.last_name.trim());
  const identityNumberValid = TEN_DIGIT_PATTERN.test(editValues.identity_number);
  const homeAddressValid = editValues.home_address.trim().length > 0;
  const emailValid = EMAIL_PATTERN.test(user.email ?? "");
  const phoneValid = TEN_DIGIT_PATTERN.test(editValues.phone);
  const canSaveProfile = usernameValid && aliasValid && firstNameValid && lastNameValid && identityNumberValid && homeAddressValid && emailValid && phoneValid;

  const saveUser = useMutation({
    onMutate: () => {
      setErrorMsg(null);
    },
    mutationFn: async () => {
      // Verificar que la sucursal no tenga ya un supervisor activo (distinto al usuario actual)
      if (selectedUserType === "supervisor" && selectedBranchId) {
        // 1. Obtener el role_id del supervisor
        const { data: supervisorRole, error: roleErr } = await (supabase
          .from("roles" as any)
          .select("id")
          .eq("code", "supervisor")
          .eq("is_active", true)
          .maybeSingle() as any);
        if (roleErr) throw roleErr;

        if (supervisorRole?.id) {
          // 2. Buscar si ya existe otro supervisor activo en la sucursal
          const { data: existingSupRows, error: checkErr } = await (supabase
            .from("user_branch_roles" as any)
            .select("user_id")
            .eq("branch_id", selectedBranchId)
            .eq("role_id", supervisorRole.id)
            .eq("is_active", true)
            .neq("user_id", user.id) as any);
          if (checkErr) throw checkErr;

          if (existingSupRows && existingSupRows.length > 0) {
            // 3. Obtener el nombre del supervisor existente
            const existingUserId = existingSupRows[0].user_id;
            const { data: supProfile } = await (supabase
              .from("profiles" as any)
              .select("first_name, last_name, username, alias")
              .eq("id", existingUserId)
              .maybeSingle() as any);
            const p = supProfile as any;
            const handle = getUserAlias(p) || "otro usuario";
            const name = p?.first_name
              ? `${p.first_name}${p.last_name ? " " + p.last_name : ""} (${handle})`
              : handle;
            throw new Error(
              `Esta sucursal ya tiene un supervisor asignado: ${name}. Solo puede haber un supervisor por sucursal.`
            );
          }
        }
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          first_name: editValues.first_name.trim(),
          last_name: editValues.last_name.trim(),
          username: editValues.username,
          alias: editValues.alias,
          identity_number: editValues.identity_number.trim() || null,
          home_address: editValues.home_address.trim() || null,
          phone: editValues.phone.trim() || null,
        } as any)
        .eq("id", user.id);
      if (profileError) throw profileError;

      if (selectedUserType === "administrador") {
        if (!isAdmin) {
          const { error } = await supabase.rpc("assign_user_global_role" as any, {
            p_target_user_id: user.id,
            p_role_code: "administrador",
          } as any);
          if (error) throw error;
        }

        for (const assignment of user.branch_assignments) {
          const { error } = await supabase.rpc("remove_user_branch_role" as any, {
            p_target_user_id: user.id,
            p_branch_id: assignment.branch_id,
            p_role_code: assignment.role_code,
            p_reason: "Limpiar asignaciones de sucursal al convertir en administrador",
          } as any);
          if (error) throw error;
        }

        return;
      }

      if (selectedUserType === "supervisor" && !selectedBranchId) {
        throw new Error("Selecciona una sucursal para el supervisor.");
      }

      if (isAdmin) {
        const { error } = await supabase.rpc("remove_user_global_role" as any, {
          p_target_user_id: user.id,
          p_role_code: "administrador",
        } as any);
        if (error) throw error;
      }

      for (const assignment of user.branch_assignments) {
        const { error } = await supabase.rpc("remove_user_branch_role" as any, {
          p_target_user_id: user.id,
          p_branch_id: assignment.branch_id,
          p_role_code: assignment.role_code,
          p_reason: "Reemplazo de asignacion unica por sucursal",
        } as any);
        if (error) throw error;
      }

      if (!selectedBranchId) {
        const { error: clearBranchError } = await (supabase.from("profiles") as any)
          .update({ active_branch_id: null })
          .eq("id", user.id);
        if (clearBranchError) throw clearBranchError;
        return;
      }

      const resolvedBranchRoleCode = resolveRoleCodeFromCatalog(
        catalog?.branch_roles,
        selectedUserType as "supervisor" | "usuario_operativo",
      );

      const { error: assignError } = await supabase.rpc("assign_user_branch_role" as any, {
        p_target_user_id: user.id,
        p_branch_id: selectedBranchId,
        p_role_code: resolvedBranchRoleCode,
        p_reason: "Asignacion unica desde administracion",
      } as any);
      if (assignError) throw assignError;

      const { error: activeBranchError } = await supabase.rpc("set_user_active_branch", {
        p_target_user_id: user.id,
        p_new_branch_id: selectedBranchId,
        p_reason: "Sucursal unica desde administracion",
      });
      if (activeBranchError) throw activeBranchError;
    },
    onSuccess: () => {
      setErrorMsg(null);
      onRefresh();
      if (user.id === profile?.id) {
        void refreshProfile();
      }
      handleClose();
      toast.success("Usuario actualizado");
    },
    onError: (e: any) => {
      const msg = e.message || "Error al actualizar";
      setErrorMsg(msg);
      toast.error(msg);
    },
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
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-h-dialog-safe w-[calc(100vw-1.5rem)] overflow-y-auto rounded-3xl p-0 sm:max-w-3xl">
        <div className="border-b border-slate-100 bg-gradient-to-r from-primary/5 to-transparent p-5 pr-14 sm:p-6">
          <div className="flex items-start gap-4">
            <div
              className="group relative shrink-0 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              title="Cambiar foto"
            >
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={displayName}
                  className="h-14 w-14 rounded-full object-cover ring-4 ring-primary/20 transition-opacity group-hover:opacity-70 sm:h-16 sm:w-16"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-black text-primary ring-4 ring-primary/10 transition-opacity group-hover:opacity-70 sm:h-16 sm:w-16 sm:text-2xl">
                  {displayName.charAt(0).toUpperCase()}
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

            <div className="min-w-0 flex-1 space-y-0.5">
              <DialogTitle className="text-lg font-black leading-tight text-slate-900">{displayName}</DialogTitle>
              <p className="text-sm font-semibold text-muted-foreground">{getUserAlias(user)}</p>
              {user.email && (
                <p className="break-all text-xs text-muted-foreground">{user.email}</p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <ChangePasswordDialog
              targetUserId={user.id}
              targetUserName={displayName}
              targetUserEmail={user.email ?? null}
              targetUsername={user.username}
              trigger={
                <Button size="sm" variant="outline" className="h-9 gap-1.5 whitespace-nowrap rounded-xl text-xs font-semibold">
                  <KeyRound className="h-3.5 w-3.5 shrink-0" />
                  Cambiar contrasena
                </Button>
              }
            />
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre de usuario</label>
                <Input
                  value={editValues.username}
                  onChange={(e) => setEditValues({ ...editValues, username: e.target.value.replace(/[^A-Za-z0-9]/g, "") })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
                {editValues.username && !usernameValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras y numeros</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Alias</label>
                <Input
                  value={editValues.alias}
                  onChange={(e) => setEditValues({ ...editValues, alias: e.target.value.replace(/[^A-Za-z0-9]/g, "") })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
                {editValues.alias && !aliasValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras y numeros</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">No. de cedula</label>
                <Input
                  value={editValues.identity_number}
                  maxLength={10}
                  inputMode="numeric"
                  onChange={(e) => setEditValues({ ...editValues, identity_number: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
                {editValues.identity_number && !identityNumberValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">La cedula debe tener exactamente 10 numeros</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombres</label>
                <Input
                  value={editValues.first_name}
                  onChange={(e) => setEditValues({ ...editValues, first_name: e.target.value.replace(/[^\p{L}\s]/gu, "") })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
                {editValues.first_name && !firstNameValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Apellidos</label>
                <Input
                  value={editValues.last_name}
                  onChange={(e) => setEditValues({ ...editValues, last_name: e.target.value.replace(/[^\p{L}\s]/gu, "") })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
                {editValues.last_name && !lastNameValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Direccion domiciliaria</label>
              <Input
                value={editValues.home_address}
                onChange={(e) => setEditValues({ ...editValues, home_address: e.target.value })}
                className="h-10 rounded-xl border-slate-200"
                disabled={isProtected}
              />
              {editValues.home_address && !homeAddressValid && (
                <p className="ml-1 text-[11px] font-medium text-destructive">La direccion es obligatoria</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Correo electronico</label>
              <Input
                value={user.email ?? ""}
                className="h-10 rounded-xl border-slate-200 bg-slate-50 text-sm text-muted-foreground"
                disabled
                title={user.email ?? undefined}
              />
              {user.email && !emailValid && (
                <p className="ml-1 text-[11px] font-medium text-destructive">Correo invalido</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Telefono</label>
                <Input
                  value={editValues.phone}
                  maxLength={10}
                  inputMode="numeric"
                  onChange={(e) => setEditValues({ ...editValues, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                  className="h-10 rounded-xl border-slate-200"
                  disabled={isProtected}
                />
                {editValues.phone && !phoneValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">El telefono debe tener exactamente 10 numeros</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                  if (val === "supervisor" && !selectedBranchId) {
                    setSelectedBranchId(initialBranchId || "");
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
                <div className="flex min-h-[18px] flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Sucursal asignada
                  </span>
                  {!isNewSupervisor && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      (opcional)
                    </span>
                  )}
                </div>
                <Select
                  value={selectedBranchId || (isNewSupervisor ? undefined : NO_BRANCH_VALUE)}
                  onValueChange={(value) => setSelectedBranchId(value === NO_BRANCH_VALUE ? "" : value)}
                  disabled={isProtected || saveUser.isPending}
                >
                  <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white">
                    <SelectValue placeholder="Seleccionar sucursal" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {!isNewSupervisor && (
                      <SelectItem value={NO_BRANCH_VALUE}>Sin sucursal</SelectItem>
                    )}
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
          
          {errorMsg && (
            <div className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive border border-destructive/20 animate-in fade-in slide-in-from-bottom-2 duration-200">
              {errorMsg}
            </div>
          )}
        </div>

        {!isProtected && (
          <div className="footer-safe-bottom sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white/95 px-5 pt-4 backdrop-blur-sm sm:px-6">
            <Button
              size="sm"
              variant="ghost"
              className="h-9 shrink-0 whitespace-nowrap rounded-xl px-5 text-xs font-semibold text-slate-600"
              onClick={handleClose}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => saveUser.mutate()}
              disabled={saveUser.isPending || !canSaveProfile || (isNewSupervisor && !selectedBranchId)}
              className="h-9 shrink-0 whitespace-nowrap rounded-xl px-5 text-xs font-bold shadow-sm sm:px-6"
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
