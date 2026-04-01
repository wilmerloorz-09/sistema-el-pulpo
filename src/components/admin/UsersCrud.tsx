import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Save, X, Building2, Check, KeyRound, Shield, ChevronDown, ChevronUp, Search, Users, UserCheck, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import EditUserDialog from "./EditUserDialog";

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
  avatar_url?: string | null;
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

const ROLE_COLORS: Record<string, string> = {
  'Administrador Global': 'bg-purple-100 text-purple-800 border-purple-200',
  'Administrador':        'bg-purple-100 text-purple-800 border-purple-200',
  'Supervisor de Sucursal': 'bg-teal-100 text-teal-800 border-teal-200',
  'Supervisor':           'bg-teal-100 text-teal-800 border-teal-200',
  'Usuario Operativo':    'bg-blue-100 text-blue-800 border-blue-200',
  'Cajero':               'bg-amber-100 text-amber-800 border-amber-200',
  'Mesero':               'bg-blue-100 text-blue-800 border-blue-200',
  'Despachador':          'bg-green-100 text-green-800 border-green-200',
};
const getRoleColor = (roleName: string) =>
  ROLE_COLORS[roleName] ?? 'bg-gray-100 text-gray-700 border-gray-200';

const UsersCrud = () => {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ full_name: "", username: "", email: "" });
  const [addingAssignmentFor, setAddingAssignmentFor] = useState<string | null>(null);
  const [newAssignmentBranchId, setNewAssignmentBranchId] = useState("");
  const [newAssignmentRoleCode, setNewAssignmentRoleCode] = useState("");
  const [search, setSearch] = useState('');
  const [filterRol, setFilterRol] = useState('__all__');
  const [filterSucursal, setFilterSucursal] = useState('__all__');
  const [filterActivo, setFilterActivo] = useState<'todos' | 'activos' | 'inactivos'>('todos');
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    full_name: "",
    username: "",
    branch_id: "",
    role_code: "usuario_operativo",
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

  // Delete física eliminada: la desactivación se hace solo con toggleActive (is_active = false)

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
        role_code: "usuario_operativo",
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

  // Métricas calculadas en cliente
  const totalUsuarios = users.length;
  const activos = users.filter(u => u.is_active).length;
  const inactivos = totalUsuarios - activos;
  const rolesDistintos = new Set(
    users.flatMap(u => [
      ...u.global_roles.map(r => r.name),
      ...u.branch_assignments.map(a => a.role_name),
    ])
  ).size;

  // Opciones únicas para filtros
  const uniqueRoles = useMemo(() => {
    const roles = new Set<string>();
    users.forEach(u => {
      u.global_roles.forEach(r => roles.add(r.name));
      u.branch_assignments.forEach(a => roles.add(a.role_name));
    });
    return Array.from(roles).sort();
  }, [users]);

  const uniqueBranches = useMemo(() => {
    const branches = new Map<string, string>();
    users.forEach(u => u.branch_assignments.forEach(a => branches.set(a.branch_id, a.branch_name)));
    return Array.from(branches.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [users]);

  // Filtrado en cliente
  const filteredUsers = useMemo(() => users.filter(u => {
    const activeBranch = u.branch_assignments.find(a => a.branch_id === u.active_branch_id);
    const activeRole = u.global_roles[0]?.name ?? activeBranch?.role_name ?? '';
    const matchSearch = !search ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (u.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase());
    const matchRol = filterRol === '__all__' ||
      u.global_roles.some(r => r.name === filterRol) ||
      u.branch_assignments.some(a => a.role_name === filterRol);
    const matchSuc = filterSucursal === '__all__' ||
      u.branch_assignments.some(a => a.branch_id === filterSucursal);
    const matchActivo = filterActivo === 'todos' ||
      (filterActivo === 'activos' && u.is_active) ||
      (filterActivo === 'inactivos' && !u.is_active);
    return matchSearch && matchRol && matchSuc && matchActivo;
  }), [users, search, filterRol, filterSucursal, filterActivo]);

  const startEditing = (user: UserRow) => {
    setEditingUserId(user.id);
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
    <div className="space-y-4">
      {/* ── Métricas ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-slate-900">{totalUsuarios}</span>
            <Users className="mb-1 h-4 w-4 text-slate-400" />
          </div>
        </div>
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">Activos</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-green-700">{activos}</span>
            <UserCheck className="mb-1 h-4 w-4 text-green-500" />
          </div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">Inactivos</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-red-600">{inactivos}</span>
            <UserX className="mb-1 h-4 w-4 text-red-400" />
          </div>
        </div>
        <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-500">Tipos de Rol</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-purple-700">{rolesDistintos}</span>
            <Shield className="mb-1 h-4 w-4 text-purple-400" />
          </div>
        </div>
      </div>

      {/* ── Filtros + Botón Agregar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Buscar nombre, email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 rounded-xl border-slate-200 pl-9 text-sm"
            />
          </div>
          <Select value={filterRol} onValueChange={setFilterRol}>
            <SelectTrigger className="h-9 w-[160px] rounded-xl border-slate-200 text-xs">
              <SelectValue placeholder="Todos los roles" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="__all__">Todos los roles</SelectItem>
              {uniqueRoles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSucursal} onValueChange={setFilterSucursal}>
            <SelectTrigger className="h-9 w-[160px] rounded-xl border-slate-200 text-xs">
              <SelectValue placeholder="Todas las sucursales" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="__all__">Todas las sucursales</SelectItem>
              {uniqueBranches.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterActivo} onValueChange={v => setFilterActivo(v as 'todos' | 'activos' | 'inactivos')}>
            <SelectTrigger className="h-9 w-[130px] rounded-xl border-slate-200 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="activos">Activos</SelectItem>
              <SelectItem value="inactivos">Inactivos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => setShowAddForm(true)} className="h-9 gap-1.5 rounded-xl font-display text-xs" disabled={showAddForm}>
          <Plus className="h-4 w-4" />
          Agregar usuario
        </Button>
      </div>

      {showAddForm && (
        <div className="space-y-4 rounded-3xl border border-primary/20 bg-primary/5 p-6 animate-in fade-in zoom-in duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary">Nuevo usuario</h3>
            <Badge variant="outline" className="border-primary/20 bg-white text-primary">3 Roles Disponibles</Badge>
          </div>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre Completo</label>
              <Input placeholder="Ej: Juan Perez" value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} className="h-10 rounded-xl border-slate-200 bg-white text-sm focus:ring-1" />
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nombre de Usuario</label>
              <Input placeholder="Ej: jperez" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} className="h-10 rounded-xl border-slate-200 bg-white text-sm focus:ring-1" />
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Email</label>
              <Input placeholder="correo@ejemplo.com" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="h-10 rounded-xl border-slate-200 bg-white text-sm focus:ring-1" />
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Contraseña</label>
              <Input placeholder="********" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="h-10 rounded-xl border-slate-200 bg-white text-sm focus:ring-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white/60 p-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tipo de Acceso</label>
              <Select 
                value={newUser.is_admin ? "admin" : "staff"} 
                onValueChange={(val) => {
                  const isAdmin = val === "admin";
                  setNewUser({ 
                    ...newUser, 
                    is_admin: isAdmin,
                    // Si es admin, desactivamos sucursal inicial requerida para simplificar
                    branch_id: isAdmin ? "" : newUser.branch_id,
                    role_code: isAdmin ? "" : (newUser.role_code || "usuario_operativo")
                  });
                }}
              >
                <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="admin">Administrador Global</SelectItem>
                  <SelectItem value="staff">Personal de Sucursal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!newUser.is_admin && (
              <>
                <div className="space-y-1.5">
                  <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sucursal</label>
                  <Select value={newUser.branch_id || undefined} onValueChange={(value) => setNewUser({ ...newUser, branch_id: value })}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {(catalog?.branches ?? []).map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Rol Operativo</label>
                  <Select value={newUser.role_code} onValueChange={(value) => setNewUser({ ...newUser, role_code: value })}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {(catalog?.branch_roles ?? []).map((role) => (
                        <SelectItem key={role.id} value={role.code}>{role.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {newUser.is_admin && (
              <div className="col-span-2 flex items-center p-4">
                <p className="text-xs text-muted-foreground italic">
                  * El Administrador Global tendrá acceso total a todas las sucursales del sistema.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} className="h-10 rounded-xl px-4 text-xs font-bold hover:bg-slate-200">
              CANCELAR
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
              className="h-10 rounded-xl px-6 text-xs font-bold shadow-lg"
            >
              {createUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              GUARDAR USUARIO
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_15px_45px_-30px_rgba(15,23,42,0.25)]">
        {/* Encabezado de columnas */}
        <div className="hidden items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 sm:flex sm:px-6">
          <div className="w-10 shrink-0" />{/* Avatar */}
          <div className="w-96 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Usuario</div>
          <div className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo de usuario</div>
          <div className="w-52 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Sucursal</div>
          <div className="flex-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Último acceso</div>
          <div className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Estado</div>
          <div className="w-20 shrink-0 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">Acción</div>
        </div>
        <div className="divide-y divide-slate-100">
          {filteredUsers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Users className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">Sin resultados</p>
              <p className="text-xs">Ajusta los filtros para ver usuarios</p>
            </div>
          )}
          {filteredUsers.map((user, idx) => {
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
          const isAdmin = user.global_roles.some((r) => r.code === "administrador");
          const isSupervisor = !isAdmin && user.branch_assignments.some((a) => a.role_code === "supervisor");
          const userTypeName = isAdmin
            ? "Administrador Global"
            : isSupervisor
            ? "Supervisor de Sucursal"
            : "Usuario Operativo";
          const userTypeColor = isAdmin
            ? "border-violet-200 bg-violet-50 text-violet-700"
            : isSupervisor
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-slate-50 text-slate-600";

            return (
              <div key={user.id} className={cn("transition-colors", idx % 2 === 0 ? "bg-white" : "bg-slate-50/40")}>
                {/* ── Fila principal ── */}
                <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  {/* Foto / Avatar — columna independiente al inicio */}
                  <div className="flex w-10 shrink-0 items-center justify-center">
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={user.full_name}
                        className={cn(
                          "h-9 w-9 rounded-full object-cover ring-2",
                          user.is_active ? "ring-primary/20" : "ring-slate-200 opacity-50 grayscale"
                        )}
                      />
                    ) : (
                      <div className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                        user.is_active ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-400"
                      )}>
                        {user.full_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Nombre + Email */}
                  <div className="flex w-96 shrink-0 min-w-0 flex-col justify-center">
                    <p className={cn("truncate text-sm font-semibold", user.is_active ? "text-slate-900" : "text-slate-400 line-through")}>
                      {user.full_name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{user.email ?? `@${user.username}`}</p>
                  </div>

                  {/* Tipo de usuario */}
                  <div className="hidden w-36 shrink-0 sm:block">
                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold", userTypeColor)}>
                      {userTypeName}
                    </span>
                  </div>

                  {/* Sucursal — muestra todas las sucursales asignadas */}
                  <div className="hidden w-52 shrink-0 sm:flex sm:flex-col sm:gap-1">
                    {isAdmin ? (
                      <span className="text-xs text-slate-400">Todas</span>
                    ) : uniqueBranchAssignments.length === 0 ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : uniqueBranchAssignments.length === 1 ? (
                      <p className="truncate text-xs text-slate-600">
                        {branchesMap[uniqueBranchAssignments[0].branch_id] ?? uniqueBranchAssignments[0].branch_name}
                      </p>
                    ) : (
                      uniqueBranchAssignments.map((a) => (
                        <span
                          key={a.branch_id}
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
                            user.active_branch_id === a.branch_id
                              ? "bg-primary/10 text-primary"
                              : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {user.active_branch_id === a.branch_id && (
                            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-primary inline-block" />
                          )}
                          {branchesMap[a.branch_id] ?? a.branch_name}
                        </span>
                      ))
                    )}
                  </div>

                  {/* Último acceso */}
                  <div className="hidden flex-1 sm:block">
                    <p className="text-xs text-slate-400">—</p>
                  </div>

                  {/* Estado (switch) */}
                  <div className="flex w-28 shrink-0 items-center gap-2">
                    <Switch
                      checked={user.is_active}
                      disabled={isProtected}
                      onCheckedChange={(checked) => toggleActive.mutate({ id: user.id, is_active: checked })}
                    />
                    <span className="hidden text-[10px] font-medium text-slate-500 sm:inline">
                      {user.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </div>

                  {/* Acciones */}
                  <div className="flex shrink-0 items-center gap-1">
                    <ChangePasswordDialog
                      targetUserId={user.id}
                      targetUserName={user.full_name}
                      trigger={
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-primary transition-colors" title="Cambiar contraseña">
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-primary/30 hover:bg-primary/5 hover:text-primary transition-colors"
                      onClick={() => setEditingUserId(user.id)}
                    >
                      Editar
                    </Button>
                  </div>
                </div>

                {/* Modal de edición */}
                {editingUserId === user.id && (
                  <EditUserDialog
                    user={user}
                    open={true}
                    onClose={() => setEditingUserId(null)}
                    onRefresh={refreshAll}
                    branchesMap={branchesMap}
                    catalog={catalog}
                  />
                )}
              </div>
            );
        })}
      </div>
    </div>
  </div>
  );
};

export default UsersCrud;
