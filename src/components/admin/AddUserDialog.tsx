import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Building2, Camera, Check, Loader2, Shield, UserPlus } from "lucide-react";
import { getUserAlias } from "@/lib/userDisplay";
import { resolveRoleCodeFromCatalog } from "./userRoleUtils";

interface AccessCatalog {
  branches: { id: string; name: string }[];
  branch_roles: { id: string; code: string; name: string }[];
  global_roles: { id: string; code: string; name: string }[];
}

interface AddUserDialogProps {
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  catalog: AccessCatalog | undefined;
  existingUsers: { email?: string | null; username: string; alias?: string }[];
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
  first_name: "",
  last_name: "",
  username: "",
  alias: "",
  identity_number: "",
  home_address: "",
  phone: "",
  email: "",
  password: "",
  confirmPassword: "",
  user_type: "usuario_operativo" as "administrador" | "supervisor" | "usuario_operativo",
};

const USERNAME_PATTERN = /^[A-Za-z0-9]+$/;
const NAME_PATTERN = /^[\p{L}\s]+$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEN_DIGIT_PATTERN = /^\d{10}$/;
const NO_BRANCH_VALUE = "__sin_sucursal__";

const AddUserDialog = ({ open, onClose, onRefresh, catalog, existingUsers }: AddUserDialogProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(defaultForm);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = form.user_type === "administrador";
  const isSupervisor = form.user_type === "supervisor";
  const usernameValid = USERNAME_PATTERN.test(form.username);
  const aliasValid = USERNAME_PATTERN.test(form.alias);
  const firstNameValid = NAME_PATTERN.test(form.first_name.trim());
  const lastNameValid = NAME_PATTERN.test(form.last_name.trim());
  const identityNumberValid = TEN_DIGIT_PATTERN.test(form.identity_number);
  const homeAddressValid = form.home_address.trim().length > 0;
  const emailValid = EMAIL_PATTERN.test(form.email.trim());
  const phoneValid = TEN_DIGIT_PATTERN.test(form.phone);
  const passwordValid = form.password.length >= 6;

  const handleClose = () => {
    setForm(defaultForm);
    setAvatarFile(null);
    setAvatarPreview(null);
    setSelectedBranchId("");
    setErrorMsg(null);
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

  const createUser = useMutation({
    onMutate: () => {
      setErrorMsg(null);
    },
    mutationFn: async () => {
      // Verificar que la sucursal no tenga ya un supervisor activo
      if (form.user_type === "supervisor" && selectedBranchId) {
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
            .eq("is_active", true) as any);
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

      const normalizedEmail = form.email.trim().toLowerCase();
      const normalizedUsername = form.username.trim().toLowerCase();
      const normalizedAlias = form.alias.trim().toLowerCase();
      const firstName = form.first_name.trim();
      const lastName = form.last_name.trim();

      const existingUsername = existingUsers.find(
        (u) => u.username.trim().toLowerCase() === normalizedUsername,
      );
      if (existingUsername) throw new Error("El nombre de usuario ya existe. Usa otro diferente.");

      const existingAlias = existingUsers.find(
        (u) => (u.alias ?? u.username).trim().toLowerCase() === normalizedAlias,
      );
      if (existingAlias) throw new Error("El alias ya existe. Usa otro diferente.");

      const existingEmail = existingUsers.find(
        (u) => (u.email ?? "").trim().toLowerCase() === normalizedEmail,
      );
      if (existingEmail) throw new Error("El correo electronico ya esta registrado.");

      const branchRoleCode =
        form.user_type === "administrador"
          ? null
          : resolveRoleCodeFromCatalog(catalog?.branch_roles, form.user_type);

      const payload = {
        email: normalizedEmail,
        password: form.password,
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim(),
        username: form.username.trim(),
        alias: form.alias.trim(),
        identity_number: form.identity_number.trim() || null,
        home_address: form.home_address.trim() || null,
        phone: form.phone.trim() || null,
        branch_roles:
          !isAdmin && selectedBranchId && branchRoleCode
            ? [{ branch_id: selectedBranchId, role_code: branchRoleCode }]
            : [],
        global_roles: isAdmin ? ["administrador"] : [],
      };

      const res = await supabase.functions.invoke("create-user", { body: payload });
      if (res.error) throw new Error(await extractEdgeFunctionError(res.error));
      if (res.data?.error) throw new Error(res.data.error);

      let createdUserId: string | null = typeof res.data?.id === "string" ? res.data.id : null;

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

      if (!createdUserId) {
        throw new Error("El usuario se creo, pero no se pudo resolver su perfil para completar la asignacion inicial.");
      }

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

      if (!isAdmin && selectedBranchId && branchRoleCode) {
        const { error: assignErr } = await supabase.rpc("assign_user_branch_role" as any, {
          p_target_user_id: createdUserId,
          p_branch_id: selectedBranchId,
          p_role_code: branchRoleCode,
          p_reason: "Asignacion inicial al crear usuario",
        } as any);
        if (assignErr && !isAlreadyExistsAssignmentError(assignErr)) throw assignErr;

        const { error: activeBranchErr } = await supabase.rpc("set_user_active_branch", {
          p_target_user_id: createdUserId,
          p_new_branch_id: selectedBranchId,
          p_reason: "Sucursal inicial al crear usuario",
        });
        if (activeBranchErr) throw activeBranchErr;
      }

      if (isAdmin) {
        const { error: adminErr } = await supabase.rpc("assign_user_global_role" as any, {
          p_target_user_id: createdUserId,
          p_role_code: "administrador",
        } as any);
        if (adminErr && !isAlreadyExistsAssignmentError(adminErr)) throw adminErr;
      }
    },
    onSuccess: () => {
      setErrorMsg(null);
      onRefresh();
      handleClose();
      toast.success("Usuario creado correctamente");
    },
    onError: (e: any) => {
      const msg = e.message || "No se pudo crear el usuario";
      setErrorMsg(msg);
      toast.error(msg);
    },
  });

  const passwordsMatch = form.password === form.confirmPassword;
  const canSubmit =
    usernameValid &&
    aliasValid &&
    firstNameValid &&
    lastNameValid &&
    identityNumberValid &&
    homeAddressValid &&
    emailValid &&
    phoneValid &&
    passwordValid &&
    !!form.confirmPassword &&
    passwordsMatch &&
    (!isSupervisor || !!selectedBranchId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-0">
        <div className="relative flex items-center gap-5 border-b border-slate-100 bg-gradient-to-r from-primary/5 to-transparent p-6">
          <div
            className="group relative shrink-0 cursor-pointer"
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

          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-black text-slate-900">Nuevo Usuario</DialogTitle>
            <p className="text-sm text-muted-foreground">Completa los datos para crear la cuenta</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">Haz clic en el icono para agregar una foto (opcional)</p>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre de usuario</label>
                <Input
                  placeholder="Ej: jperez"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value.replace(/[^A-Za-z0-9]/g, "") })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.username && !usernameValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras y numeros</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Alias</label>
                <Input
                  placeholder="Ej: JuanP"
                  value={form.alias}
                  onChange={(e) => setForm({ ...form, alias: e.target.value.replace(/[^A-Za-z0-9]/g, "") })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.alias && !aliasValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras y numeros</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">No. de cedula</label>
                <Input
                  placeholder="Ej: 1300000000"
                  value={form.identity_number}
                  maxLength={10}
                  inputMode="numeric"
                  onChange={(e) => setForm({ ...form, identity_number: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.identity_number && !identityNumberValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">La cedula debe tener exactamente 10 numeros</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombres</label>
                <Input
                  placeholder="Ej: Juan Carlos"
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value.replace(/[^\p{L}\s]/gu, "") })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.first_name && !firstNameValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Apellidos</label>
                <Input
                  placeholder="Ej: Perez Zambrano"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value.replace(/[^\p{L}\s]/gu, "") })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.last_name && !lastNameValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Solo letras</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Direccion domiciliaria</label>
              <Input
                placeholder="Direccion del domicilio"
                value={form.home_address}
                onChange={(e) => setForm({ ...form, home_address: e.target.value })}
                className="h-10 rounded-xl border-slate-200"
              />
              {form.home_address && !homeAddressValid && (
                <p className="ml-1 text-[11px] font-medium text-destructive">La direccion es obligatoria</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Correo electronico</label>
                <Input
                  placeholder="correo@ejemplo.com"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.email && !emailValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Ingresa un correo valido</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Telefono</label>
                <Input
                  placeholder="Ej: 0999999999"
                  value={form.phone}
                  maxLength={10}
                  inputMode="numeric"
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.phone && !phoneValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">El telefono debe tener exactamente 10 numeros</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Contrasena</label>
                <Input
                  placeholder="********"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="h-10 rounded-xl border-slate-200"
                />
                {form.password && !passwordValid && (
                  <p className="ml-1 text-[11px] font-medium text-destructive">Minimo 6 caracteres</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Confirmar Contrasena</label>
                <Input
                  placeholder="********"
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
                  <p className="ml-1 text-[11px] font-medium text-destructive">Las contrasenas no coinciden</p>
                )}
                {form.confirmPassword && passwordsMatch && (
                  <p className="ml-1 text-[11px] font-medium text-green-600">Las contrasenas coinciden</p>
                )}
              </div>
            </div>
          </div>

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
                  setSelectedBranchId("");
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
              <p className="ml-1 text-[11px] italic text-muted-foreground">
                El Administrador General tendra acceso total a todas las sucursales del sistema.
              </p>
            )}
          </div>

          {!isAdmin && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Sucursal asignada {isSupervisor ? "" : "(opcional)"}
                </span>
              </div>
              <Select
                value={selectedBranchId || (isSupervisor ? undefined : NO_BRANCH_VALUE)}
                onValueChange={(value) => setSelectedBranchId(value === NO_BRANCH_VALUE ? "" : value)}
              >
                <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white">
                  <SelectValue placeholder="Seleccionar sucursal..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {!isSupervisor && (
                    <SelectItem value={NO_BRANCH_VALUE}>Sin sucursal</SelectItem>
                  )}
                  {(catalog?.branches ?? []).map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="ml-1 text-[11px] italic text-muted-foreground">
                {isSupervisor
                  ? "El supervisor debe tener una sucursal asignada."
                  : "El usuario operativo puede crearse sin sucursal y asignarse despues."}
              </p>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive border border-destructive/20 animate-in fade-in slide-in-from-bottom-2 duration-200">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="footer-safe-bottom sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white/95 px-6 pt-4 backdrop-blur-sm">
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
            {createUser.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-2 h-3.5 w-3.5" />
            )}
            Crear usuario
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddUserDialog;
