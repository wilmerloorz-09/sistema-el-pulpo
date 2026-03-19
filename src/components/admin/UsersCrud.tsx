import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Save, X, Building2, Pencil, Check, KeyRound, Shield } from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

interface AccessCatalog {
  branches: { id: string; name: string }[];
  branch_roles: { id: string; code: string; name: string }[];
  global_roles: { id: string; code: string; name: string }[];
}

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
  is_protected_superadmin?: boolean;
  global_roles: { code: string; name: string }[];
  branch_assignments: BranchAssignment[];
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
      // ignore parse failures
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

const UsersCrud = () => {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ full_name: "", username: "", email: "" });
  const [addingAssignmentFor, setAddingAssignmentFor] = useState<string | null>(null);
  const [newAssignmentBranchId, setNewAssignmentBranchId] = useState("");
  const [newAssignmentRoleCode, setNewAssignmentRoleCode] = useState("");
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    full_name: "",
    username: "",
    branch_id: "",
    role_code: "mesero",
    is_admin: false,
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users-access"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users_access" as never);
      if (error) throw error;
      return (data ?? []) as unknown as UserRow[];
    },
  });

  const { data: catalog } = useQuery({
    queryKey: ["admin-access-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_access_catalog" as never);
      if (error) throw error;
      return (data ?? { branches: [], branch_roles: [], global_roles: [] }) as unknown as AccessCatalog;
    },
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-users-access"] });
    qc.invalidateQueries({ queryKey: ["admin-access-catalog"] });
  };

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refreshAll,
    onError: (err: any) => toast.error(err.message || "No se pudo actualizar el estado"),
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, full_name, username }: { id: string; full_name: string; username: string }) => {
      const { error } = await supabase.from("profiles").update({ full_name, username }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      setEditingProfile(null);
      toast.success("Usuario actualizado");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo actualizar el usuario"),
  });

  const setActiveBranch = useMutation({
    mutationFn: async ({ user_id, branch_id }: { user_id: string; branch_id: string }) => {
      const { error } = await supabase.rpc("set_user_active_branch", {
        p_target_user_id: user_id,
        p_new_branch_id: branch_id,
        p_reason: "Cambio de sucursal activa desde administracion",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      toast.success("Sucursal activa actualizada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo actualizar la sucursal activa"),
  });

  const saveAssignment = useMutation({
    mutationFn: async ({ user_id, branch_id, role_code }: { user_id: string; branch_id: string; role_code: string }) => {
      const { error } = await supabase.rpc("assign_user_branch_role" as never, {
        p_target_user_id: user_id,
        p_branch_id: branch_id,
        p_role_code: role_code,
        p_reason: "Asignacion desde administracion",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      setAddingAssignmentFor(null);
      setNewAssignmentBranchId("");
      setNewAssignmentRoleCode("");
      toast.success("Asignacion guardada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo guardar la asignacion"),
  });

  const removeAssignment = useMutation({
    mutationFn: async ({ user_id, branch_id, role_code }: { user_id: string; branch_id: string; role_code: string }) => {
      const { error } = await supabase.rpc("remove_user_branch_role" as never, {
        p_target_user_id: user_id,
        p_branch_id: branch_id,
        p_role_code: role_code,
        p_reason: "Remocion desde administracion",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      toast.success("Asignacion removida");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo remover la asignacion"),
  });

  const toggleAdmin = useMutation({
    mutationFn: async ({ user_id, enable }: { user_id: string; enable: boolean }) => {
      const fn = enable ? "assign_user_global_role" : "remove_user_global_role";
      const { error } = await supabase.rpc(fn as never, {
        p_target_user_id: user_id,
        p_role_code: "administrador",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      toast.success("Rol global actualizado");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo actualizar el rol global"),
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const normalizedEmail = newUser.email.trim().toLowerCase();
      const normalizedUsername = newUser.username.trim().toLowerCase();

      const existingUsername = users.find((row) => row.username.trim().toLowerCase() === normalizedUsername);
      if (existingUsername) {
        throw new Error("El nombre de usuario ya existe. Usa otro diferente.");
      }

      const existingEmail = users.find((row) => (row.email ?? "").trim().toLowerCase() === normalizedEmail);
      if (existingEmail) {
        throw new Error("El correo electronico ya esta registrado.");
      }

      const payload = {
        email: normalizedEmail,
        password: newUser.password,
        full_name: newUser.full_name,
        username: newUser.username.trim(),
        branch_roles: newUser.branch_id
          ? [{ branch_id: newUser.branch_id, role_code: newUser.role_code }]
          : [],
        global_roles: newUser.is_admin ? ["administrador"] : [],
      };

      const res = await supabase.functions.invoke("create-user", { body: payload });
      if (res.error) throw new Error(await extractEdgeFunctionError(res.error));
      if (res.data?.error) throw new Error(res.data.error);

      let createdUserId: string | null = typeof res.data?.id === "string" ? res.data.id : null;

      if (!createdUserId) {
        const { data: createdProfileByEmail, error: profileLookupByEmailError } = await supabase
          .from("profiles")
          .select("id")
          .ilike("email", normalizedEmail)
          .limit(1)
          .maybeSingle();

        if (profileLookupByEmailError) throw profileLookupByEmailError;
        createdUserId = createdProfileByEmail?.id ?? null;
      }

      if (!createdUserId) {
        const { data: createdProfileByUsername, error: profileLookupByUsernameError } = await supabase
          .from("profiles")
          .select("id")
          .ilike("username", newUser.username.trim())
          .limit(1)
          .maybeSingle();

        if (profileLookupByUsernameError) throw profileLookupByUsernameError;
        createdUserId = createdProfileByUsername?.id ?? null;
      }

      if (!createdUserId) {
        throw new Error("El usuario se creo, pero no se pudo resolver su perfil para completar la asignacion inicial.");
      }

      if (newUser.branch_id && newUser.role_code) {
        const { error: assignBranchRoleError } = await supabase.rpc("assign_user_branch_role" as never, {
          p_target_user_id: createdUserId,
          p_branch_id: newUser.branch_id,
          p_role_code: newUser.role_code,
          p_reason: "Asignacion inicial al crear usuario",
        } as never);

        if (assignBranchRoleError && !isAlreadyExistsAssignmentError(assignBranchRoleError)) {
          throw assignBranchRoleError;
        }

        const { error: activeBranchError } = await supabase.rpc("set_user_active_branch", {
          p_target_user_id: createdUserId,
          p_new_branch_id: newUser.branch_id,
          p_reason: "Sucursal inicial al crear usuario",
        });
        if (activeBranchError) throw activeBranchError;
      }

      if (newUser.is_admin) {
        const { error: assignGlobalRoleError } = await supabase.rpc("assign_user_global_role" as never, {
          p_target_user_id: createdUserId,
          p_role_code: "administrador",
        } as never);

        if (assignGlobalRoleError && !isAlreadyExistsAssignmentError(assignGlobalRoleError)) {
          throw assignGlobalRoleError;
        }
      }
    },
    onSuccess: () => {
      refreshAll();
      setShowAddForm(false);
      setNewUser({
        email: "",
        password: "",
        full_name: "",
        username: "",
        branch_id: "",
        role_code: "mesero",
        is_admin: false,
      });
      toast.success("Usuario creado correctamente");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo crear el usuario"),
  });

  const branchesMap = useMemo(
    () => Object.fromEntries((catalog?.branches ?? []).map((branch) => [branch.id, branch.name])),
    [catalog?.branches],
  );

  const startEditing = (user: UserRow) => {
    setEditingProfile(user.id);
    setEditValues({ full_name: user.full_name, username: user.username, email: user.email ?? "" });
  };

  const openAssignmentEditor = (userId: string) => {
    setAddingAssignmentFor(userId);
    setNewAssignmentBranchId("");
    setNewAssignmentRoleCode("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAddForm(true)} className="h-10 w-full gap-1.5 rounded-xl font-display text-xs sm:h-9 sm:w-auto" disabled={showAddForm}>
          <Plus className="h-4 w-4" />
          Agregar usuario
        </Button>
      </div>

      {showAddForm && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">Nuevo usuario</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input placeholder="Nombre completo" value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Input placeholder="Nombre de usuario" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Input placeholder="Email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Input placeholder="Contrasena" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Select value={newUser.branch_id || undefined} onValueChange={(value) => setNewUser({ ...newUser, branch_id: value })}>
              <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="Sucursal inicial" /></SelectTrigger>
              <SelectContent>
                {(catalog?.branches ?? []).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newUser.role_code} onValueChange={(value) => setNewUser({ ...newUser, role_code: value })}>
              <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="Rol de sucursal" /></SelectTrigger>
              <SelectContent>
                {(catalog?.branch_roles ?? []).map((role) => (
                  <SelectItem key={role.id} value={role.code}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center justify-between rounded-lg border border-border bg-background/70 px-3 py-2 text-sm">
            <span>Administrador global</span>
            <Switch checked={newUser.is_admin} onCheckedChange={(checked) => setNewUser({ ...newUser, is_admin: checked })} />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} className="h-10 rounded-lg text-xs gap-1 sm:h-9">
              <X className="h-3.5 w-3.5" /> Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => createUser.mutate()}
              disabled={
                createUser.isPending ||
                !newUser.email ||
                !newUser.password ||
                !newUser.full_name ||
                !newUser.username ||
                (!newUser.is_admin && (!newUser.branch_id || !newUser.role_code))
              }
              className="h-10 rounded-lg text-xs gap-1 sm:h-9"
            >
              {createUser.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Crear usuario
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {users.map((user) => {
          const isEditing = editingProfile === user.id;
          const isProtected = Boolean(user.is_protected_superadmin);
          const branchOptions = catalog?.branches ?? [];
          const uniqueBranchAssignments = Array.from(
            new Map(user.branch_assignments.map((assignment) => [assignment.branch_id, assignment])).values(),
          );
          const activeBranchAssignment =
            user.branch_assignments.find((assignment) => assignment.branch_id === user.active_branch_id) ??
            user.branch_assignments[0] ??
            null;
          const assignedRoleCodesForSelectedBranch = user.branch_assignments
            .filter((assignment) => assignment.branch_id === newAssignmentBranchId)
            .map((assignment) => assignment.role_code);
          const isAdmin = user.global_roles.some((role) => role.code === "administrador");

          return (
            <div key={user.id} className="space-y-3 rounded-xl border border-border bg-card p-3">
              {isEditing ? (
                <>
                  <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Editar usuario</h3>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          Activo
                          <Switch checked={user.is_active} disabled={isProtected} onCheckedChange={(checked) => toggleActive.mutate({ id: user.id, is_active: checked })} />
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input value={editValues.full_name} onChange={(e) => setEditValues({ ...editValues, full_name: e.target.value })} placeholder="Nombre completo" className="h-9 rounded-lg text-sm" />
                      <Input value={editValues.username} onChange={(e) => setEditValues({ ...editValues, username: e.target.value })} placeholder="Nombre de usuario" className="h-9 rounded-lg text-sm" />
                      <Input value={editValues.email} disabled placeholder="Email" className="h-9 rounded-lg text-sm opacity-80" />
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                        <KeyRound className="h-4 w-4" />
                        La contrasena se cambia desde el boton de llave
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Sucursal activa</p>
                        <Select value={user.active_branch_id ?? undefined} onValueChange={(value) => setActiveBranch.mutate({ user_id: user.id, branch_id: value })} disabled={isProtected || uniqueBranchAssignments.length === 0}>
                          <SelectTrigger className="h-9 rounded-lg text-sm">
                            <SelectValue placeholder="Selecciona sucursal activa" />
                          </SelectTrigger>
                          <SelectContent>
                            {uniqueBranchAssignments.map((assignment) => (
                              <SelectItem key={assignment.branch_id} value={assignment.branch_id}>
                                {branchesMap[assignment.branch_id] ?? assignment.branch_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <label className="flex items-center justify-between rounded-lg border border-border bg-background/70 px-3 py-2 text-sm">
                        <span>Administrador global</span>
                        <Switch checked={isAdmin} disabled={isProtected} onCheckedChange={(checked) => toggleAdmin.mutate({ user_id: user.id, enable: checked })} />
                      </label>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium">Rol en sucursal activa</p>
                      <div className="flex flex-wrap gap-1">
                        {activeBranchAssignment ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {activeBranchAssignment.role_name} - {branchesMap[activeBranchAssignment.branch_id] ?? activeBranchAssignment.branch_name}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Sin rol de sucursal</Badge>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium">Asignaciones por sucursal</p>
                      <div className="flex flex-wrap gap-1">
                        {user.branch_assignments.map((assignment) => (
                          <Badge key={`${assignment.branch_id}-${assignment.role_code}`} variant={user.active_branch_id === assignment.branch_id ? "default" : "outline"} className="gap-1 pr-1 text-[10px]">
                            <Building2 className="h-2.5 w-2.5" />
                            {assignment.branch_name} - {assignment.role_name}
                            {user.active_branch_id === assignment.branch_id ? " (Activa)" : ""}
                            <button disabled={isProtected} onClick={() => removeAssignment.mutate({ user_id: user.id, branch_id: assignment.branch_id, role_code: assignment.role_code })} className="hover:text-destructive disabled:opacity-50">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>

                      {addingAssignmentFor === user.id ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/70 p-2">
                          <Select
                            value={newAssignmentBranchId || undefined}
                            onValueChange={(value) => {
                              setNewAssignmentBranchId(value);
                              setNewAssignmentRoleCode("");
                            }}
                          >
                            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                            <SelectContent>
                              {branchOptions.map((branch) => (
                                <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={newAssignmentRoleCode || undefined} onValueChange={setNewAssignmentRoleCode}>
                            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Rol" /></SelectTrigger>
                            <SelectContent>
                              {(catalog?.branch_roles ?? []).map((role) => (
                                <SelectItem key={role.id} value={role.code} disabled={assignedRoleCodesForSelectedBranch.includes(role.code)}>
                                  {role.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => saveAssignment.mutate({ user_id: user.id, branch_id: newAssignmentBranchId, role_code: newAssignmentRoleCode })}
                            disabled={!newAssignmentBranchId || !newAssignmentRoleCode || assignedRoleCodesForSelectedBranch.includes(newAssignmentRoleCode) || saveAssignment.isPending}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setAddingAssignmentFor(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-lg text-xs" disabled={isProtected} onClick={() => openAssignmentEditor(user.id)}>
                          <Plus className="h-3.5 w-3.5" />
                          Agregar asignacion
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <ChangePasswordDialog
                        targetUserId={user.id}
                        targetUserName={user.full_name}
                        trigger={
                          <Button size="sm" variant="outline" className="h-10 rounded-lg text-xs gap-1 sm:h-9">
                            <KeyRound className="h-3.5 w-3.5" />
                            Cambiar contrasena
                          </Button>
                        }
                      />
                      <Button size="sm" variant="ghost" className="h-10 rounded-lg text-xs gap-1 sm:h-9" onClick={() => setEditingProfile(null)}>
                        <X className="h-3.5 w-3.5" />
                        Cancelar
                      </Button>
                      <Button size="sm" className="h-10 rounded-lg text-xs gap-1 sm:h-9" onClick={() => updateProfile.mutate({ id: user.id, full_name: editValues.full_name, username: editValues.username })}>
                        <Check className="h-3.5 w-3.5" />
                        Guardar cambios
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-semibold">{user.full_name}</p>
                      <p className="text-xs text-muted-foreground">@{user.username}{user.email ? ` - ${user.email}` : ""}</p>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEditing(user)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <ChangePasswordDialog
                        targetUserId={user.id}
                        targetUserName={user.full_name}
                        trigger={
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <Switch checked={user.is_active} disabled={isProtected} onCheckedChange={(checked) => toggleActive.mutate({ id: user.id, is_active: checked })} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium">Rol en sucursal activa</p>
                    <div className="flex flex-wrap gap-1">
                      {activeBranchAssignment ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {activeBranchAssignment.role_name} - {branchesMap[activeBranchAssignment.branch_id] ?? activeBranchAssignment.branch_name}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Sin rol de sucursal</Badge>
                      )}
                    </div>
                  </div>

                  {(user.global_roles.length > 0 || isAdmin) && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium">Rol global</p>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Shield className="h-3.5 w-3.5" />
                          Administrador
                          <Switch checked={isAdmin} disabled={isProtected} onCheckedChange={(checked) => toggleAdmin.mutate({ user_id: user.id, enable: checked })} />
                        </label>
                      </div>
                      {user.global_roles.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {user.global_roles.map((role) => (
                            <Badge key={role.code} variant="secondary" className="text-[10px]">{role.name}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs font-medium">Asignaciones por sucursal</p>
                    <div className="flex flex-wrap gap-1">
                      {user.branch_assignments.map((assignment) => (
                        <Badge key={`${assignment.branch_id}-${assignment.role_code}`} variant={user.active_branch_id === assignment.branch_id ? "default" : "outline"} className="gap-1 pr-1 text-[10px]">
                          <Building2 className="h-2.5 w-2.5" />
                          {assignment.branch_name} - {assignment.role_name}
                          {user.active_branch_id === assignment.branch_id ? " (Activa)" : ""}
                          <button disabled={isProtected} onClick={() => removeAssignment.mutate({ user_id: user.id, branch_id: assignment.branch_id, role_code: assignment.role_code })} className="hover:text-destructive disabled:opacity-50">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>

                    {uniqueBranchAssignments.length > 0 && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <span className="text-xs text-muted-foreground">Sucursal activa:</span>
                        <Select value={user.active_branch_id ?? undefined} onValueChange={(value) => setActiveBranch.mutate({ user_id: user.id, branch_id: value })} disabled={isProtected}>
                          <SelectTrigger className="h-9 w-full text-xs sm:h-8 sm:w-56"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                          <SelectContent>
                            {uniqueBranchAssignments.map((assignment) => (
                              <SelectItem key={assignment.branch_id} value={assignment.branch_id}>{branchesMap[assignment.branch_id] ?? assignment.branch_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {addingAssignmentFor === user.id ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                        <Select
                          value={newAssignmentBranchId || undefined}
                          onValueChange={(value) => {
                            setNewAssignmentBranchId(value);
                            setNewAssignmentRoleCode("");
                          }}
                        >
                          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                          <SelectContent>
                            {branchOptions.map((branch) => (
                              <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={newAssignmentRoleCode || undefined} onValueChange={setNewAssignmentRoleCode}>
                          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Rol" /></SelectTrigger>
                          <SelectContent>
                            {(catalog?.branch_roles ?? []).map((role) => (
                              <SelectItem key={role.id} value={role.code} disabled={assignedRoleCodesForSelectedBranch.includes(role.code)}>
                                {role.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => saveAssignment.mutate({ user_id: user.id, branch_id: newAssignmentBranchId, role_code: newAssignmentRoleCode })}
                          disabled={!newAssignmentBranchId || !newAssignmentRoleCode || assignedRoleCodesForSelectedBranch.includes(newAssignmentRoleCode) || saveAssignment.isPending}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setAddingAssignmentFor(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={isProtected} onClick={() => openAssignmentEditor(user.id)}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UsersCrud;
