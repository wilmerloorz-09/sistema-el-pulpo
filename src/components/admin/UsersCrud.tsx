import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Save, X, Building2, Pencil, Check, KeyRound, Shield } from "lucide-react";
import { useMemo, useState } from "react";
import { Constants } from "@/integrations/supabase/types";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Profile {
  id: string;
  full_name: string;
  username: string;
  is_active: boolean;
  active_branch_id: string | null;
  is_protected_superadmin?: boolean;
}

interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

interface Branch {
  id: string;
  name: string;
}

interface UserBranch {
  id: string;
  user_id: string;
  branch_id: string;
}

interface ModuleRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface UserBranchModule {
  id: string;
  user_id: string;
  branch_id: string;
  module_id: string;
  is_active: boolean;
}



const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  mesero: "Mesero",
  cajero: "Cajero",
  cocina: "Cocina",
  despachador_mesas: "Despacho Mesas",
  despachador_takeout: "Despacho Takeout",
  supervisor: "Supervisor",
  superadmin: "Super Admin",
};

const ADMIN_ROLES = ["admin", "supervisor", "superadmin"] as const;
const ALL_APP_ROLES = [...Constants.public.Enums.app_role] as AppRole[];
const ADMIN_MODULE_CODES = ["usuarios", "configuracion", "sucursales"] as const;
const OPERATIVE_MODULE_CODES = ["mesas", "ordenes", "despacho", "caja", "pagos", "reportes"] as const;
const MODULE_TEMPLATES = [
  { key: "mesero", label: "Mesero", modules: ["mesas", "ordenes"] },
  { key: "cajero", label: "Cajero", modules: ["caja", "pagos"] },
  { key: "cocina", label: "Cocina", modules: ["despacho"] },
  { key: "despachador_mesas", label: "Despacho Mesas", modules: ["despacho"] },
  { key: "despachador_takeout", label: "Despacho Takeout", modules: ["despacho"] },
] as const;
const extractDbError = (err: any) => {
  if (!err) return "Error desconocido";
  const parts = [err.message, err.details, err.hint].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "Error desconocido";
};
const extractEdgeFunctionError = async (err: any) => {
  if (!err) return "Error desconocido al crear usuario";

  const context = err.context;
  if (context && typeof context.text === "function") {
    try {
      const raw = await context.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.error) return parsed.error;
          return raw;
        } catch {
          return raw;
        }
      }
    } catch {
      // ignore read failures
    }
  }

  return err.message || "Error desconocido al crear usuario";
};
const UsersCrud = () => {
  const qc = useQueryClient();
  const [addingRoleFor, setAddingRoleFor] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<AppRole>("mesero");
  const [addingBranchFor, setAddingBranchFor] = useState<string | null>(null);
  const [newBranchId, setNewBranchId] = useState<string>("");
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ full_name: string; username: string }>({ full_name: "", username: "" });
  const [showAddForm, setShowAddForm] = useState(false);
  const [openModulesFor, setOpenModulesFor] = useState<string | null>(null);
  const [moduleBranchByUser, setModuleBranchByUser] = useState<Record<string, string>>({});
  const [selectedTemplateByUser, setSelectedTemplateByUser] = useState<Record<string, string>>({});
  const [newUser, setNewUser] = useState({ email: "", password: "", full_name: "", username: "", role: "mesero" as AppRole, branch_id: "" });

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, username, is_active, active_branch_id, is_protected_superadmin").order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("*");
      if (error) throw error;
      return data as UserRole[];
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ["admin-branches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as Branch[];
    },
  });

  const { data: userBranches = [] } = useQuery({
    queryKey: ["admin-user-branches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_branches").select("*");
      if (error) throw error;
      return data as UserBranch[];
    },
  });

  const { data: modules = [] } = useQuery({
    queryKey: ["admin-modules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("modules").select("id, code, name, is_active").eq("is_active", true).order("name");
      if (error) throw error;
      return (data ?? []) as ModuleRow[];
    },
  });

  const { data: userBranchModules = [] } = useQuery({
    queryKey: ["admin-user-branch-modules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_branch_modules").select("id, user_id, branch_id, module_id, is_active");
      if (error) throw error;
      return (data ?? []) as UserBranchModule[];
    },
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    qc.invalidateQueries({ queryKey: ["admin-user-roles"] });
    qc.invalidateQueries({ queryKey: ["admin-user-branches"] });
    qc.invalidateQueries({ queryKey: ["admin-user-branch-modules"] });
  };

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refreshAll,
    onError: (err: any) => toast.error(extractDbError(err)),
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
    onError: (err: any) => toast.error(extractDbError(err)),
  });

  const addRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: AppRole }) => {
      const { error } = await supabase.from("user_roles").insert({ user_id, role });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-roles"] });
      setAddingRoleFor(null);
      toast.success("Rol agregado");
    },
    onError: (err: any) => toast.error(extractDbError(err)),
  });

  const removeRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-roles"] });
      toast.success("Rol eliminado");
    },
    onError: (err: any) => toast.error(extractDbError(err)),
  });

  const addBranch = useMutation({
    mutationFn: async ({ user_id, branch_id }: { user_id: string; branch_id: string }) => {
      const { error } = await supabase.rpc("assign_user_branch", {
        p_target_user_id: user_id,
        p_branch_id: branch_id,
        p_reason: "Asignacion de sucursal desde administracion",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      setAddingBranchFor(null);
      toast.success("Sucursal asignada");
    },
    onError: (err: any) => toast.error(extractDbError(err)),
  });

  const removeBranch = useMutation({
    mutationFn: async ({ user_id, branch_id }: { user_id: string; branch_id: string }) => {
      const { error } = await supabase.rpc("remove_user_branch", {
        p_target_user_id: user_id,
        p_branch_id: branch_id,
        p_reason: "Remocion de sucursal desde administracion",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      toast.success("Sucursal removida");
    },
    onError: (err: any) => toast.error(extractDbError(err)),
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
    onError: (err: any) => toast.error(extractDbError(err)),
  });

  const setModuleAccess = useMutation({
    mutationFn: async ({ user_id, branch_id, module_code, is_active }: { user_id: string; branch_id: string; module_code: string; is_active: boolean }) => {
      const { error } = await supabase.rpc("upsert_user_branch_module", {
        p_target_user_id: user_id,
        p_branch_id: branch_id,
        p_module_code: module_code,
        p_is_active: is_active,
        p_reason: "Ajuste de modulo desde administracion",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-branch-modules"] });
      toast.success("Permiso actualizado");
    },
    onError: (err: any) => toast.error(extractDbError(err)),
  });


  const applyModuleTemplate = useMutation({
    mutationFn: async ({
      user_id,
      branch_id,
      template_modules,
    }: {
      user_id: string;
      branch_id: string;
      template_modules: readonly string[];
    }) => {
      for (const moduleCode of OPERATIVE_MODULE_CODES) {
        const { error } = await supabase.rpc("upsert_user_branch_module", {
          p_target_user_id: user_id,
          p_branch_id: branch_id,
          p_module_code: moduleCode,
          p_is_active: template_modules.includes(moduleCode),
          p_reason: "Aplicacion de plantilla operativa desde administracion",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-branch-modules"] });
      toast.success("Plantilla aplicada");
    },
    onError: (err: any) => toast.error(extractDbError(err)),
  });
  const createUser = useMutation({
    mutationFn: async () => {
      const res = await supabase.functions.invoke("create-user", {
        body: {
          email: newUser.email,
          password: newUser.password,
          full_name: newUser.full_name,
          username: newUser.username,
          roles: [newUser.role],
          branch_ids: newUser.branch_id ? [newUser.branch_id] : [],
        },
      });

      if (res.error) {
        const details = await extractEdgeFunctionError(res.error);
        throw new Error(details);
      }

      if (res.data?.error) {
        throw new Error(res.data.error);
      }
    },
    onSuccess: () => {
      refreshAll();
      setShowAddForm(false);
      setNewUser({ email: "", password: "", full_name: "", username: "", role: "mesero", branch_id: "" });
      toast.success("Usuario creado correctamente");
    },
    onError: (err: any) => toast.error(extractDbError(err)),
  });

  const branchesMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);

  const getUserModuleState = (userId: string, branchId: string, moduleId: string) => {
    return userBranchModules.find(
      (row) => row.user_id === userId && row.branch_id === branchId && row.module_id === moduleId
    )?.is_active ?? false;
  };

  const startEditing = (profile: Profile) => {
    setEditingProfile(profile.id);
    setEditValues({ full_name: profile.full_name, username: profile.username });
  };

  if (loadingProfiles) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAddForm(true)} className="gap-1.5 rounded-xl font-display text-xs" disabled={showAddForm}>
          <Plus className="h-4 w-4" />
          Agregar usuario
        </Button>
      </div>

      {showAddForm && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <h3 className="text-sm font-semibold">Nuevo usuario</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Nombre completo" value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Input placeholder="Nombre de usuario" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Input placeholder="Email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Input placeholder="Contrasena" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="h-9 rounded-lg text-sm" />
            <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as AppRole })}>
              <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="Rol" /></SelectTrigger>
              <SelectContent>
                {ALL_APP_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newUser.branch_id} onValueChange={(v) => setNewUser({ ...newUser, branch_id: v })}>
              <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="Sucursal" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} className="rounded-lg text-xs gap-1">
              <X className="h-3.5 w-3.5" /> Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => createUser.mutate()}
              disabled={createUser.isPending || !newUser.email || !newUser.password || !newUser.full_name || !newUser.username || !newUser.branch_id}
              className="rounded-lg text-xs gap-1"
            >
              {createUser.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Crear usuario
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {profiles.map((profile) => {
          const userRoles = roles.filter((r) => r.user_id === profile.id);
          const userBranchList = userBranches.filter((ub) => ub.user_id === profile.id);
          const existingRoleNames = userRoles.map((r) => r.role);
          const targetHasAdminScope = existingRoleNames.some((r) => ["admin", "superadmin", "supervisor"].includes(r));
          const administrativeRoles = userRoles.filter((r) => ADMIN_ROLES.includes(r.role as typeof ADMIN_ROLES[number]));
          const availableRoleNames = ADMIN_ROLES.filter((r) => !existingRoleNames.includes(r as AppRole)) as AppRole[];
          const existingBranchIds = userBranchList.map((ub) => ub.branch_id);
          const availableBranches = branches.filter((b) => !existingBranchIds.includes(b.id));
          const isEditing = editingProfile === profile.id;
          const isModuleOpen = openModulesFor === profile.id;
          const isProtectedSuperadmin = Boolean(profile.is_protected_superadmin);

          const selectedModuleBranchId =
            moduleBranchByUser[profile.id] ||
            profile.active_branch_id ||
            userBranchList[0]?.branch_id ||
            "";

          return (
            <div key={profile.id} className="rounded-xl border border-border bg-card p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  {isEditing ? (
                    <div className="flex gap-2">
                      <Input value={editValues.full_name} onChange={(e) => setEditValues({ ...editValues, full_name: e.target.value })} className="h-8 text-sm" />
                      <Input value={editValues.username} onChange={(e) => setEditValues({ ...editValues, username: e.target.value })} className="h-8 text-sm" />
                    </div>
                  ) : (
                    <>
                      <p className="font-semibold">{profile.full_name}</p>
                      <p className="text-xs text-muted-foreground">@{profile.username}</p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-primary" onClick={() => updateProfile.mutate({ id: profile.id, ...editValues })}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingProfile(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEditing(profile)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setOpenModulesFor(isModuleOpen ? null : profile.id)}>
                        <Shield className="h-3.5 w-3.5" />
                      </Button>
                      <ChangePasswordDialog
                        targetUserId={profile.id}
                        targetUserName={profile.full_name}
                        trigger={
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                    </>
                  )}
                  <Switch checked={profile.is_active} disabled={isProtectedSuperadmin} onCheckedChange={(v) => toggleActive.mutate({ id: profile.id, is_active: v })} />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium mb-1">Perfil administrativo</p>
                <p className="text-[10px] text-muted-foreground mb-1">Solo para jerarquia (admin/supervisor). La operacion diaria se define abajo por modulos.</p>
                <div className="flex flex-wrap gap-1 items-center">
                  {administrativeRoles.length === 0 && (<Badge variant="outline" className="text-[10px]">Sin perfil administrativo</Badge>)}{administrativeRoles.map((ur) => (
                    <Badge key={ur.id} variant="secondary" className="text-[10px] gap-1 pr-1">
                      {ROLE_LABELS[ur.role] ?? ur.role}
                      <button disabled={isProtectedSuperadmin && ur.role === "superadmin"} onClick={() => removeRole.mutate(ur.id)} className="hover:text-destructive disabled:opacity-50">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {addingRoleFor === profile.id ? (
                    <div className="flex items-center gap-1">
                      <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                        <SelectTrigger className="h-7 w-36 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ALL_APP_ROLES.map((r) => (
                            <SelectItem key={r} value={r} disabled={existingRoleNames.includes(r)}>
                              {ROLE_LABELS[r] ?? r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                                            <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isProtectedSuperadmin || existingRoleNames.includes(newRole)}
                        onClick={() => addRole.mutate({ user_id: profile.id, role: newRole })}
                      >
                        OK
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingRoleFor(null)}>X</Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      disabled={isProtectedSuperadmin || availableRoleNames.length === 0}
                      onClick={() => {
                        setAddingRoleFor(profile.id);
                        setNewRole(availableRoleNames[0] ?? "admin");
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">Sucursales</p>
                <div className="flex flex-wrap gap-1 items-center">
                  {userBranchList.map((ub) => (
                    <Badge key={ub.id} variant={profile.active_branch_id === ub.branch_id ? "default" : "outline"} className="text-[10px] gap-1 pr-1">
                      <Building2 className="h-2.5 w-2.5" />
                      {branchesMap[ub.branch_id] ?? "-"}
                      {profile.active_branch_id === ub.branch_id ? " (Activa)" : ""}
                      <button disabled={isProtectedSuperadmin} onClick={() => removeBranch.mutate({ user_id: profile.id, branch_id: ub.branch_id })} className="hover:text-destructive disabled:opacity-50">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {addingBranchFor === profile.id ? (
                    <div className="flex items-center gap-1">
                      <Select value={newBranchId} onValueChange={setNewBranchId}>
                        <SelectTrigger className="h-7 w-36 rounded-lg text-xs"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                        <SelectContent>
                          {availableBranches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-7 text-xs" disabled={!newBranchId || isProtectedSuperadmin} onClick={() => addBranch.mutate({ user_id: profile.id, branch_id: newBranchId })}>OK</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingBranchFor(null)}>X</Button>
                    </div>
                  ) : (
                    availableBranches.length > 0 && (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={isProtectedSuperadmin} onClick={() => { setAddingBranchFor(profile.id); setNewBranchId(""); }}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )
                  )}
                </div>

                {userBranchList.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Sucursal activa:</span>
                    <Select
                      value={profile.active_branch_id ?? ""}
                      onValueChange={(value) => setActiveBranch.mutate({ user_id: profile.id, branch_id: value })}
                      disabled={isProtectedSuperadmin}
                    >
                      <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                      <SelectContent>
                        {userBranchList.map((ub) => (
                          <SelectItem key={ub.branch_id} value={ub.branch_id}>{branchesMap[ub.branch_id] ?? ub.branch_id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {isModuleOpen && userBranchList.length > 0 && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">Permisos por modulo</p>
                    <Select
                      value={selectedModuleBranchId}
                      onValueChange={(value) =>
                        setModuleBranchByUser((prev) => ({
                          ...prev,
                          [profile.id]: value,
                        }))
                      }
                      disabled={isProtectedSuperadmin}
                    >
                      <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                      <SelectContent>
                        {userBranchList.map((ub) => (
                          <SelectItem key={ub.branch_id} value={ub.branch_id}>{branchesMap[ub.branch_id] ?? ub.branch_id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                                    {selectedModuleBranchId && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium">Perfil operativo (por sucursal)</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={selectedTemplateByUser[profile.id] ?? MODULE_TEMPLATES[0].key}
                          onValueChange={(value) =>
                            setSelectedTemplateByUser((prev) => ({
                              ...prev,
                              [profile.id]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MODULE_TEMPLATES.map((template) => (
                              <SelectItem key={template.key} value={template.key}>{template.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          disabled={isProtectedSuperadmin || applyModuleTemplate.isPending}
                          onClick={() => {
                            const key = selectedTemplateByUser[profile.id] ?? MODULE_TEMPLATES[0].key;
                            const selectedTemplate = MODULE_TEMPLATES.find((t) => t.key === key) ?? MODULE_TEMPLATES[0];
                            applyModuleTemplate.mutate({
                              user_id: profile.id,
                              branch_id: selectedModuleBranchId,
                              template_modules: selectedTemplate.modules,
                            });
                          }}
                        >
                          Aplicar perfil
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {modules
                      .filter((moduleRow) => targetHasAdminScope || !ADMIN_MODULE_CODES.includes(moduleRow.code as typeof ADMIN_MODULE_CODES[number]))
                      .map((moduleRow) => {
                      const enabled = selectedModuleBranchId
                        ? getUserModuleState(profile.id, selectedModuleBranchId, moduleRow.id)
                        : false;

                      return (
                        <label key={moduleRow.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs">
                          <span>{moduleRow.name}</span>
                          <Switch
                            checked={enabled}
                            disabled={isProtectedSuperadmin && ["sucursales", "usuarios", "configuracion", "branches"].includes(moduleRow.code)}
                            onCheckedChange={(value) => {
                              if (!selectedModuleBranchId) return;
                              setModuleAccess.mutate({
                                user_id: profile.id,
                                branch_id: selectedModuleBranchId,
                                module_code: moduleRow.code,
                                is_active: value,
                              });
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UsersCrud;




































