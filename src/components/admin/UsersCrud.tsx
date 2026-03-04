import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Constants } from "@/integrations/supabase/types";
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

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  mesero: "Mesero",
  cajero: "Cajero",
  cocina: "Cocina",
  despachador_mesas: "Despacho Mesas",
  despachador_takeout: "Despacho Takeout",
};

const UsersCrud = () => {
  const qc = useQueryClient();
  const [addingRoleFor, setAddingRoleFor] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<AppRole>("mesero");

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

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-profiles"] }),
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

  if (loadingProfiles) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="hidden sm:grid bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          style={{ gridTemplateColumns: "1fr 1fr 2fr 4rem" }}>
          <div>Nombre</div>
          <div>Usuario</div>
          <div>Roles</div>
          <div>Activo</div>
        </div>

        {profiles.map((profile) => {
          const userRoles = roles.filter((r) => r.user_id === profile.id);
          const isAdding = addingRoleFor === profile.id;
          const existingRoleNames = userRoles.map(r => r.role);

          return (
            <div key={profile.id} className="grid items-center gap-2 px-3 py-3 border-t border-border text-sm"
              style={{ gridTemplateColumns: "1fr 1fr 2fr 4rem" }}>
              <span className="font-medium truncate">{profile.full_name}</span>
              <span className="text-muted-foreground truncate text-xs">{profile.username}</span>
              <div className="flex flex-wrap gap-1 items-center">
                {userRoles.map((ur) => (
                  <Badge key={ur.id} variant="secondary" className="text-[10px] gap-1 pr-1">
                    {ROLE_LABELS[ur.role]}
                    <button onClick={() => removeRole.mutate(ur.id)} className="hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {isAdding ? (
                  <div className="flex items-center gap-1">
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                      <SelectTrigger className="h-7 w-32 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Constants.public.Enums.app_role
                          .filter(r => !existingRoleNames.includes(r))
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
              <div>
                <Switch checked={profile.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: profile.id, is_active: v })} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UsersCrud;
