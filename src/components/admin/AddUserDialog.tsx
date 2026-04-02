import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2,
  Camera,
  Check,
  Loader2,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";

interface AccessCatalog {
  branches: { id: string; name: string }[];
  branch_roles: { id: string; code: string; name: string }[];
  global_roles: { id: string; code: string; name: string }[];
}

interface PendingBranch {
  branch_id: string;
  branch_name: string;
}

interface AddUserDialogProps {
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  catalog: AccessCatalog | undefined;
  existingUsers: { email?: string | null; username: string }[];
}

const extractEdgeFunctionError = async (err: any) => {
  if (!err) return "Error desconocido";
  const context = err.context;
  if (context && typeof context.text === "function") {
    try {
      const raw = await context.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.error) return parsed.error;
        } catch {
          return raw;
        }
      }
    } catch {
      // ignore
    }
  }
  return err.message || "Error desconocido";
};

const isAlreadyExistsAssignmentError = (error: any) => {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("duplicate key") ||
    message.includes("already exists") ||
    message.includes("ya existe")
  );
};

const defaultForm = {
  full_name: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  user_type: "usuario_operativo" as "administrador" | "supervisor" | "usuario_operativo",
};

const AddUserDialog = ({ open, onClose, onRefresh, catalog, existingUsers }: AddUserDialogProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(defaultForm);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [pendingBranches, setPendingBranches] = useState<PendingBranch[]>([]);
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState("");

  const isAdmin = form.user_type === "administrador";

  const handleClose = () => {
    setForm(defaultForm);
    setAvatarFile(null);
    setAvatarPreview(null);
    setPendingBranches([]);
    setShowAddBranch(false);
    setSelectedBranchId("");
    onClose();
  };

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("La imagen no puede superar los 2 MB");
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const addBranch = () => {
    if (!selectedBranchId) return;
    const branch = catalog?.branches.find((b) => b.id === selectedBranchId);
    if (!branch) return;
    setPendingBranches((prev) => [...prev, { branch_id: branch.id, branch_name: branch.name }]);
    setSelectedBranchId("");
    setShowAddBranch(false);
  };

  const removeBranch = (branch_id: string) => {
    setPendingBranches((prev) => prev.filter((b) => b.branch_id !== branch_id));
  };

  const createUser = useMutation({
    mutationFn: async () => {
      const normalizedEmail = form.email.trim().toLowerCase();
      const normalizedUsername = form.username.trim().toLowerCase();

      const existingUsername = existingUsers.find(
        (u) => u.username.trim().toLowerCase() === normalizedUsername
      );
      if (existingUsername) throw new Error("El nombre de usuario ya existe. Usa otro diferente.");

      const existingEmail = existingUsers.find(
        (u) => (u.email ?? "").trim().toLowerCase() === normalizedEmail
      );
      if (existingEmail) throw new Error("El correo electrónico ya está registrado.");

      const branchRoleCode =
        form.user_type === "administrador"
          ? null
          : form.user_type === "supervisor"
            ? "supervisor"
            : "usuario_operativo";

      const payload = {
        email: normalizedEmail,
        password: form.password,
        full_name: form.full_name,
        username: form.username.trim(),
        branch_roles:
          !isAdmin && pendingBranches.length > 0 && branchRoleCode
            ? pendingBranches.map((b) => ({ branch_id: b.branch_id, role_code: branchRoleCode }))
            : [],
        global_roles: isAdmin ? ["administrador"] : [],
      };

      const res = await supabase.functions.invoke("create-user", { body: payload });
      if (res.error) throw new Error(await extractEdgeFunctionError(res.error));
      if (res.data?.error) throw new Error(res.data.error);

      let createdUserId: string | null =
        typeof res.data?.id === "string" ? res.data.id : null;

      if (!createdUserId) {
        const { data: byEmail } = await supabase
          .from("profiles")
          .select("id")
          .ilike("email", normalizedEmail)
          .limit(1)
          .maybeSingle();
        createdUserId = byEmail?.id ?? null;
      }

      if (!createdUserId) {
        const { data: byUsername } = await supabase
          .from("profiles")
          .select("id")
          .ilike("username", form.username.trim())
          .limit(1)
          .maybeSingle();
        createdUserId = byUsername?.id ?? null;
      }

      if (!createdUserId)
        throw new Error("El usuario se creó, pero no se pudo resolver su perfil para completar la asignación inicial.");

      // Subir foto si el admin eligió una
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop();
        const path = `${createdUserId}/avatar.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
          const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
          await (supabase.from("profiles") as any)
            .update({ avatar_url: publicUrl })
            .eq("id", createdUserId);
        }
      }

      // Asignar sucursales
      if (!isAdmin && pendingBranches.length > 0 && branchRoleCode) {
        for (const branch of pendingBranches) {
          const { error: assignErr } = await supabase.rpc("assign_user_branch_role" as never, {
            p_target_user_id: createdUserId,
            p_branch_id: branch.branch_id,
            p_role_code: branchRoleCode,
            p_reason: "Asignacion inicial al crear usuario",
          } as never);
          if (assignErr && !isAlreadyExistsAssignmentError(assignErr)) throw assignErr;
        }

        // Activar la primera sucursal por defecto
        const { error: activeBranchErr } = await supabase.rpc("set_user_active_branch", {
          p_target_user_id: createdUserId,
          p_new_branch_id: pendingBranches[0].branch_id,
          p_reason: "Sucursal inicial al crear usuario",
        });
        if (activeBranchErr) throw activeBranchErr;
      }

      // Asignar rol global admin
      if (isAdmin) {
        const { error: adminErr } = await supabase.rpc("assign_user_global_role" as never, {
          p_target_user_id: createdUserId,
          p_role_code: "administrador",
        } as never);
        if (adminErr && !isAlreadyExistsAssignmentError(adminErr)) throw adminErr;
      }
    },
    onSuccess: () => {
      onRefresh();
      handleClose();
      toast.success("Usuario creado correctamente");
    },
    onError: (e: any) => toast.error(e.message || "No se pudo crear el usuario"),
  });

  const passwordsMatch = form.password === form.confirmPassword;
  const canSubmit =
    !!form.full_name &&
    !!form.username &&
    !!form.email &&
    !!form.password &&
    !!form.confirmPassword &&
    passwordsMatch &&
    (isAdmin || pendingBranches.length > 0);

  const assignedBranchIds = new Set(pendingBranches.map((b) => b.branch_id));
  const availableBranches = (catalog?.branches ?? []).filter((b) => !assignedBranchIds.has(b.id));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-0">
        {/* Header: avatar clickeable + título */}
        <div className="relative flex items-center gap-5 border-b border-slate-100 bg-gradient-to-r from-primary/5 to-transparent p-6">
          {/* Avatar clickeable */}
          <div
            className="relative shrink-0 cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
            title="Agregar foto"
          >
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="Vista previa"
                className="h-16 w-16 rounded-full object-cover ring-4 ring-primary/20 transition-opacity group-hover:opacity-70"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-4 ring-primary/10 transition-opacity group-hover:opacity-70">
                <UserPlus className="h-7 w-7 text-primary" />
              </div>
            )}
            {/* Overlay hover */}
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="h-5 w-5 text-white" />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarPick}
            />
          </div>

          <div className="flex-1 min-w-0">
            <DialogTitle className="text-lg font-black text-slate-900">
              Nuevo Usuario
            </DialogTitle>
            <p className="text-sm text-muted-foreground">Completa los datos para crear la cuenta</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">Haz clic en el ícono para agregar una foto (opcional)</p>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Datos básicos */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Datos del perfil</h4>

            {/* Fila 1: Nombre y Usuario */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre Completo</label>
                <Input
                  placeholder="Ej: Juan Pérez"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="h-10 rounded-xl border-slate-200"
                />
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre de Usuario</label>
                <Input
                  placeholder="Ej: jperez"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="h-10 rounded-xl border-slate-200"
                />
              </div>
            </div>

            {/* Fila 2: Correo a ancho completo */}
            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Correo Electrónico</label>
              <Input
                placeholder="correo@ejemplo.com"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="h-10 rounded-xl border-slate-200"
              />
            </div>

            {/* Fila 3: Contraseña y Confirmar, lado a lado */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Contraseña</label>
                <Input
                  placeholder="••••••••"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="h-10 rounded-xl border-slate-200"
                />
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Confirmar Contraseña</label>
                <Input
                  placeholder="••••••••"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  className={`h-10 rounded-xl ${
                    form.confirmPassword && !passwordsMatch
                      ? "border-destructive ring-1 ring-destructive/40"
                      : form.confirmPassword && passwordsMatch
                        ? "border-green-400 ring-1 ring-green-400/40"
                        : "border-slate-200"
                  }`}
                />
                {form.confirmPassword && !passwordsMatch && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Las contraseñas no coinciden</p>
                )}
                {form.confirmPassword && passwordsMatch && (
                  <p className="ml-1 text-[11px] font-medium text-green-600">✓ Las contraseñas coinciden</p>
                )}
              </div>
            </div>
          </div>

          {/* Tipo de usuario */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tipo de usuario</span>
            </div>
            <Select
              value={form.user_type}
              onValueChange={(val) => {
                setForm({ ...form, user_type: val as typeof form.user_type });
                if (val === "administrador") {
                  setPendingBranches([]);
                  setShowAddBranch(false);
                }
              }}
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
            {isAdmin && (
              <p className="ml-1 text-[11px] text-muted-foreground italic">
                * El Administrador General tendrá acceso total a todas las sucursales del sistema.
              </p>
            )}
          </div>

          {/* Asignaciones de sucursal (solo si no es admin) */}
          {!isAdmin && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Asignaciones por Sucursal</h4>
                </div>
                {!showAddBranch && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 rounded-lg border-primary/20 bg-primary/5 px-3 text-[11px] font-bold text-primary hover:bg-primary/10"
                    onClick={() => setShowAddBranch(true)}
                    disabled={availableBranches.length === 0}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {pendingBranches.map((b) => (
                  <div
                    key={b.branch_id}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-slate-800">{b.branch_name}</span>
                    <button
                      onClick={() => removeBranch(b.branch_id)}
                      className="ml-1 rounded-full p-1 text-slate-400 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {pendingBranches.length === 0 && (
                  <p className="text-xs text-slate-400 italic">Sin asignaciones de sucursal</p>
                )}
              </div>

              {showAddBranch && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 animate-in fade-in zoom-in duration-200">
                  {availableBranches.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No hay más sucursales disponibles.</p>
                  ) : (
                    <Select
                      value={selectedBranchId || undefined}
                      onValueChange={setSelectedBranchId}
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
                      onClick={addBranch}
                      disabled={!selectedBranchId || availableBranches.length === 0}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-10 w-10 rounded-xl p-0 text-muted-foreground"
                      onClick={() => { setShowAddBranch(false); setSelectedBranchId(""); }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white/95 backdrop-blur-sm px-6 py-4">
          <Button
            size="sm"
            variant="ghost"
            className="h-9 rounded-xl px-5 text-xs font-semibold text-slate-600"
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => createUser.mutate()}
            disabled={!canSubmit || createUser.isPending}
            className="h-9 rounded-xl px-6 text-xs font-bold shadow-sm"
          >
            {createUser.isPending
              ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              : <Check className="mr-2 h-3.5 w-3.5" />}
            Crear usuario
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddUserDialog;
