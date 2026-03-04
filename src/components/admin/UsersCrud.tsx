import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Save, X, Building2, Pencil, Check, KeyRound } from "lucide-react";
import { useState } from "react";
import { Constants } from "@/integrations/supabase/types";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Profile {
  id: string;
  full_name: string;
  username: string;
  is_active: boolean;
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

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  mesero: "Mesero",
  cajero: "Cajero",
  cocina: "Cocina",
  despachador_mesas: "Despacho Mesas",
  despachador_takeout: "Despacho Takeout",
  superadmin: "Super Admin",
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
  const [newUser, setNewUser] = useState({ email: "", password: "", full_name: "", username: "", role: "mesero" as AppRole, branch_id: "" });

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("full_name");
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

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-profiles"] }),
    onError: (err: any) => toast.error(err.message),
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, full_name, username }: { id: string; full_name: string; username: string }) => {
      const { error } = await supabase.from("profiles").update({ full_name, username }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
      setEditingProfile(null);
      toast.success("Usuario actualizado");
    },
    onError: (err: any) => toast.error(err.message),
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
    onError: (err: any) => toast.error(err.message),
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
    onError: (err: any) => toast.error(err.message),
  });

  const addBranch = useMutation({
    mutationFn: async ({ user_id, branch_id }: { user_id: string; branch_id: string }) => {
      const { error } = await supabase.from("user_branches").insert({ user_id, branch_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-branches"] });
      setAddingBranchFor(null);
      toast.success("Sucursal asignada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeBranch = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_branches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-branches"] });
      toast.success("Sucursal removida");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("No autenticado");

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

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
      qc.invalidateQueries({ queryKey: ["admin-user-roles"] });
      qc.invalidateQueries({ queryKey: ["admin-user-branches"] });
      setShowAddForm(false);
      setNewUser({ email: "", password: "", full_name: "", username: "", role: "mesero", branch_id: "" });
      toast.success("Usuario creado correctamente");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const startEditing = (profile: Profile) => {
    setEditingProfile(profile.id);
    setEditValues({ full_name: profile.full_name, username: profile.username });
  };

  const cancelEditing = () => {
    setEditingProfile(null);
  };

  const saveEditing = (id: string) => {
    if (!editValues.full_name.trim() || !editValues.username.trim()) {
      toast.error("Nombre y usuario son requeridos");
      return;
    }
    updateProfile.mutate({ id, ...editValues });
  };

  if (loadingProfiles) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const branchesMap = Object.fromEntries(branches.map((b) => [b.id, b.name]));

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
            <Input
              placeholder="Nombre completo"
              value={newUser.full_name}
              onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
              className="h-9 rounded-lg text-sm"
            />
            <Input
              placeholder="Nombre de usuario"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              className="h-9 rounded-lg text-sm"
            />
            <Input
              placeholder="Email"
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              className="h-9 rounded-lg text-sm"
            />
            <Input
              placeholder="Contraseña"
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              className="h-9 rounded-lg text-sm"
            />
            <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as AppRole })}>
              <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue placeholder="Rol" /></SelectTrigger>
              <SelectContent>
                {Constants.public.Enums.app_role.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
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
              disabled={createUser.isPending || !newUser.email || !newUser.password || !newUser.full_name || !newUser.username}
              className="rounded-lg text-xs gap-1"
            >
              {createUser.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Crear usuario
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="hidden sm:grid bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          style={{ gridTemplateColumns: "1.2fr 1fr 2fr 1.8fr 3.5rem 3.5rem" }}>
          <div>Nombre</div>
          <div>Usuario</div>
          <div>Roles</div>
          <div>Sucursales</div>
          <div>Activo</div>
          <div></div>
        </div>

        {profiles.map((profile) => {
          const userRoles = roles.filter((r) => r.user_id === profile.id);
          const userBranchList = userBranches.filter((ub) => ub.user_id === profile.id);
          const isAddingRole = addingRoleFor === profile.id;
          const isAddingBranch = addingBranchFor === profile.id;
          const isEditing = editingProfile === profile.id;
          const existingRoleNames = userRoles.map((r) => r.role);
          const existingBranchIds = userBranchList.map((ub) => ub.branch_id);
          const availableBranches = branches.filter((b) => !existingBranchIds.includes(b.id));

          return (
            <div key={profile.id} className="grid items-center gap-2 px-3 py-3 border-t border-border text-sm"
              style={{ gridTemplateColumns: "1.2fr 1fr 2fr 1.8fr 3.5rem 3.5rem" }}>
              
              {/* Name */}
              {isEditing ? (
                <Input
                  value={editValues.full_name}
                  onChange={(e) => setEditValues({ ...editValues, full_name: e.target.value })}
                  className="h-8 rounded-lg text-sm"
                  autoFocus
                />
              ) : (
                <span className="font-medium truncate">{profile.full_name}</span>
              )}

              {/* Username */}
              {isEditing ? (
                <Input
                  value={editValues.username}
                  onChange={(e) => setEditValues({ ...editValues, username: e.target.value })}
                  className="h-8 rounded-lg text-sm"
                />
              ) : (
                <span className="text-muted-foreground truncate text-xs">{profile.username}</span>
              )}

              {/* Roles column */}
              <div className="flex flex-wrap gap-1 items-center">
                {userRoles.map((ur) => (
                  <Badge key={ur.id} variant="secondary" className="text-[10px] gap-1 pr-1">
                    {ROLE_LABELS[ur.role]}
                    <button onClick={() => removeRole.mutate(ur.id)} className="hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {isAddingRole ? (
                  <div className="flex items-center gap-1">
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                      <SelectTrigger className="h-7 w-32 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Constants.public.Enums.app_role
                          .filter((r) => !existingRoleNames.includes(r))
                          .map((r) => (
                            <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-7 text-xs rounded-lg" onClick={() => addRole.mutate({ user_id: profile.id, role: newRole })}>
                      OK
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingRoleFor(null)}>✕</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setAddingRoleFor(profile.id); setNewRole("mesero"); }}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Branches column */}
              <div className="flex flex-wrap gap-1 items-center">
                {userBranchList.map((ub) => (
                  <Badge key={ub.id} variant="outline" className="text-[10px] gap-1 pr-1">
                    <Building2 className="h-2.5 w-2.5" />
                    {branchesMap[ub.branch_id] ?? "—"}
                    <button onClick={() => removeBranch.mutate(ub.id)} className="hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {isAddingBranch ? (
                  <div className="flex items-center gap-1">
                    <Select value={newBranchId} onValueChange={setNewBranchId}>
                      <SelectTrigger className="h-7 w-32 rounded-lg text-xs"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                      <SelectContent>
                        {availableBranches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-7 text-xs rounded-lg" disabled={!newBranchId} onClick={() => addBranch.mutate({ user_id: profile.id, branch_id: newBranchId })}>
                      OK
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingBranchFor(null)}>✕</Button>
                  </div>
                ) : (
                  availableBranches.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setAddingBranchFor(profile.id); setNewBranchId(""); }}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  )
                )}
              </div>

              {/* Active toggle */}
              <div>
                <Switch checked={profile.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: profile.id, is_active: v })} />
              </div>

              {/* Edit/Save button */}
              <div>
                {isEditing ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-primary" onClick={() => saveEditing(profile.id)} disabled={updateProfile.isPending}>
                      {updateProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={cancelEditing}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => startEditing(profile)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UsersCrud;
