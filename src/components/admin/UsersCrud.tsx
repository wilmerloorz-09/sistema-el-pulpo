import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, X, Building2, Check, KeyRound, Shield, ChevronDown, ChevronUp, Search, Users, UserCheck, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import EditUserDialog from "./EditUserDialog";
import AddUserDialog from "./AddUserDialog";
import { useBranch } from "@/contexts/BranchContext";

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


const ROLE_COLORS: Record<string, string> = {
  'Administrador General': 'bg-purple-100 text-purple-800 border-purple-200',
  'Administrador':        'bg-purple-100 text-purple-800 border-purple-200',
  'Supervisor':           'bg-teal-100 text-teal-800 border-teal-200',
  'Usuario operativo':    'bg-blue-100 text-blue-800 border-blue-200',
  'Cajero':               'bg-amber-100 text-amber-800 border-amber-200',
  'Mesero':               'bg-blue-100 text-blue-800 border-blue-200',
  'Despachador':          'bg-green-100 text-green-800 border-green-200',
};
const getRoleColor = (roleName: string) =>
  ROLE_COLORS[roleName] ?? 'bg-gray-100 text-gray-700 border-gray-200';

const UsersCrud = () => {
  const qc = useQueryClient();
  const { isGlobalAdmin } = useBranch();
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

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users-access"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users_access" as any);
      if (error) throw error;
      return (data ?? []) as unknown as UserRow[];
    },
  });

  const { data: catalog } = useQuery({
    queryKey: ["admin-access-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_access_catalog" as any);
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

  if (!isGlobalAdmin) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-orange-200 bg-white/80 p-8 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Shield className="h-8 w-8" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-black text-slate-900">Acceso restringido</h2>
          <p className="max-w-xs text-sm text-slate-500">Solo los administradores globales pueden gestionar los usuarios del sistema.</p>
        </div>
      </div>
    );
  }

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
      const { error } = await supabase.rpc("assign_user_branch_role" as any, {
        p_target_user_id: user_id,
        p_branch_id: branch_id,
        p_role_code: role_code,
        p_reason: "Asignacion desde administracion",
      } as any);
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
      const { error } = await supabase.rpc("remove_user_branch_role" as any, {
        p_target_user_id: user_id,
        p_branch_id: branch_id,
        p_role_code: role_code,
        p_reason: "Remocion desde administracion",
      } as any);
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
      const { error } = await supabase.rpc(fn as any, {
        p_target_user_id: user_id,
        p_role_code: "administrador",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAll();
      toast.success("Rol global actualizado");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo actualizar el rol global"),
  });

  // Delete física eliminada: la desactivación se hace solo con toggleActive (is_active = false)

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
  const uniqueRoles = ["Administrador General", "Supervisor", "Usuario operativo"];

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
      (u.identity_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (u.phone ?? '').toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase());
    const isAdmin = u.global_roles.some((r) => r.code === "administrador");
    const isSupervisor = !isAdmin && u.branch_assignments.some((a) => a.role_code === "supervisor");

    const matchRol = filterRol === '__all__' || (
      filterRol === "Administrador General" ? isAdmin :
      filterRol === "Supervisor" ? isSupervisor :
      (!isAdmin && !isSupervisor) // Usuario operativo
    );
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
              placeholder="Buscar nombre, email, cedula..."
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

      <AddUserDialog
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        onRefresh={refreshAll}
        catalog={catalog}
        existingUsers={users}
      />

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_15px_45px_-30px_rgba(15,23,42,0.25)]">
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
        {/* Encabezado de columnas */}
        <div className="hidden items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 sm:flex sm:px-6">
          <div className="w-10 shrink-0" />{/* Avatar */}
          <div className="w-72 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 lg:w-96">Usuario</div>
          <div className="w-32 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 lg:w-36">Tipo de usuario</div>
          <div className="w-44 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 lg:w-52">Sucursal</div>
          <div className="w-24 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 lg:flex-1">Último acceso</div>
          <div className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Estado</div>
          <div className="w-28 shrink-0 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">Acción</div>
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
          const activeBranchAssignment =
            user.branch_assignments.find((assignment) => assignment.branch_id === user.active_branch_id) ??
            user.branch_assignments[0] ??
            null;
            const uniqueBranchAssignments = activeBranchAssignment ? [activeBranchAssignment] : [];
          const isAdmin = user.global_roles.some((r) => r.code === "administrador");
          const isSupervisor = !isAdmin && user.branch_assignments.some((a) => a.role_code === "supervisor");
          const userTypeName = isAdmin
            ? "Administrador General"
            : isSupervisor
            ? "Supervisor"
            : "Usuario operativo";
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
                  <button
                    type="button"
                    className="flex w-72 shrink-0 min-w-0 flex-col justify-center rounded-lg text-left outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30 lg:w-96"
                    onClick={() => setEditingUserId(user.id)}
                    title="Editar usuario"
                  >
                    <p className={cn("truncate text-sm font-semibold", user.is_active ? "text-slate-900" : "text-slate-400 line-through")}>
                      {user.full_name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{user.email ?? `@${user.username}`}</p>
                    {(user.identity_number || user.phone) && (
                      <p className="truncate text-[10px] text-slate-400">
                        {[user.identity_number ? `CI: ${user.identity_number}` : null, user.phone].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </button>

                  {/* Tipo de usuario */}
                  <div className="hidden w-32 shrink-0 sm:block lg:w-36">
                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold", userTypeColor)}>
                      {userTypeName}
                    </span>
                  </div>

                  {/* Sucursal — muestra todas las sucursales asignadas */}
                  <div className="hidden w-44 shrink-0 sm:flex sm:flex-col sm:gap-1 lg:w-52">
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
                  <div className="hidden w-24 shrink-0 sm:block lg:flex-1">
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
                  <div className="flex w-28 shrink-0 items-center justify-end gap-1">
                    <ChangePasswordDialog
                      targetUserId={user.id}
                      targetUserName={user.full_name}
                      targetUserEmail={user.email ?? null}
                      targetUsername={user.username}
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
  </div>
  </div>
  );
};

export default UsersCrud;
