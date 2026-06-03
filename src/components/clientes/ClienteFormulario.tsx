import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Cliente, ClienteFormularioValores, ClienteSexo } from "@/types/cliente";
import { CLIENTE_FORMULARIO_VACIO, CLIENTE_SEXO_OPCIONES } from "@/types/cliente";
import {
  clienteAFormulario,
  clienteFormularioEsValido,
  normalizarCedulaCelular,
  normalizarNombresApellidos,
  prepararClienteParaGuardar,
  validarClienteFormulario,
  type ErroresClienteFormulario,
} from "@/lib/clientesValidacion";
import type { ClienteInsertPayload, ClienteUpdatePayload } from "@/services/clientesDb";

export interface ClienteFormularioProps {
  abierto: boolean;
  modo: "crear" | "editar";
  clienteInicial?: Cliente | null;
  idNuevoCliente?: string;
  creadoPorId?: string | null;
  guardando?: boolean;
  onCerrar: () => void;
  onGuardar: (payload: {
    modo: "crear" | "editar";
    id: string;
    datos: ClienteInsertPayload | ClienteUpdatePayload;
  }) => Promise<void>;
}

export default function ClienteFormulario({
  abierto,
  modo,
  clienteInicial,
  idNuevoCliente,
  creadoPorId,
  guardando = false,
  onCerrar,
  onGuardar,
}: ClienteFormularioProps) {
  const [valores, setValores] = useState<ClienteFormularioValores>(CLIENTE_FORMULARIO_VACIO);
  const [errores, setErrores] = useState<ErroresClienteFormulario>({});
  const [intentoEnvio, setIntentoEnvio] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setIntentoEnvio(false);
    setErrores({});
    if (modo === "editar" && clienteInicial) {
      setValores(clienteAFormulario(clienteInicial));
    } else {
      setValores(CLIENTE_FORMULARIO_VACIO);
    }
  }, [abierto, modo, clienteInicial]);

  const titulo = modo === "crear" ? "Nuevo cliente" : "Editar cliente";
  const descripcion =
    modo === "crear"
      ? "Registra un comensal para el catálogo del turno."
      : "Actualiza los datos del comensal sin salir del listado.";

  const erroresVisibles = useMemo(() => {
    if (!intentoEnvio) return {} as ErroresClienteFormulario;
    return errores;
  }, [intentoEnvio, errores]);

  const actualizarCampo = <K extends keyof ClienteFormularioValores>(
    campo: K,
    valor: ClienteFormularioValores[K],
  ) => {
    setValores((prev) => ({ ...prev, [campo]: valor }));
    if (intentoEnvio) {
      setErrores(validarClienteFormulario({ ...valores, [campo]: valor }));
    }
  };

  const handleCerrar = () => {
    if (guardando) return;
    onCerrar();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIntentoEnvio(true);
    const validacion = validarClienteFormulario(valores);
    setErrores(validacion);
    if (!clienteFormularioEsValido(validacion)) return;

    const datos = prepararClienteParaGuardar(valores);
    const id = modo === "editar" ? clienteInicial!.id : (idNuevoCliente ?? "");

    if (!id) return;

    if (modo === "crear") {
      if (!creadoPorId) return;
      await onGuardar({
        modo: "crear",
        id,
        datos: {
          id,
          ...datos,
          creado_por: creadoPorId,
        } satisfies ClienteInsertPayload,
      });
      return;
    }

    await onGuardar({
      modo: "editar",
      id,
      datos,
    });
  };

  return (
    <Dialog open={abierto} onOpenChange={(open) => !open && handleCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9.5rem]">
            <div className="space-y-2">
              <Label htmlFor="cliente-cedula">Cédula *</Label>
              <Input
                id="cliente-cedula"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={valores.cedula}
                disabled={guardando || modo === "editar"}
                onChange={(e) => actualizarCampo("cedula", normalizarCedulaCelular(e.target.value))}
                placeholder="10 dígitos"
                className="font-mono tracking-wider"
              />
              {erroresVisibles.cedula ? (
                <p className="text-xs text-destructive">{erroresVisibles.cedula}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-sexo">Sexo *</Label>
              <Select
                value={valores.sexo}
                disabled={guardando}
                onValueChange={(value) => actualizarCampo("sexo", value as ClienteSexo)}
              >
                <SelectTrigger id="cliente-sexo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENTE_SEXO_OPCIONES.map((opcion) => (
                    <SelectItem key={opcion.value} value={opcion.value}>
                      {opcion.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {erroresVisibles.sexo ? (
                <p className="text-xs text-destructive">{erroresVisibles.sexo}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cliente-nombres">Nombres *</Label>
              <Input
                id="cliente-nombres"
                value={valores.nombres}
                disabled={guardando}
                maxLength={75}
                onChange={(e) => actualizarCampo("nombres", normalizarNombresApellidos(e.target.value))}
              />
              {erroresVisibles.nombres ? (
                <p className="text-xs text-destructive">{erroresVisibles.nombres}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-apellidos">Apellidos *</Label>
              <Input
                id="cliente-apellidos"
                value={valores.apellidos}
                disabled={guardando}
                maxLength={75}
                onChange={(e) => actualizarCampo("apellidos", normalizarNombresApellidos(e.target.value))}
              />
              {erroresVisibles.apellidos ? (
                <p className="text-xs text-destructive">{erroresVisibles.apellidos}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cliente-celular">Celular *</Label>
            <Input
              id="cliente-celular"
              inputMode="numeric"
              maxLength={10}
              value={valores.celular}
              disabled={guardando}
              onChange={(e) => actualizarCampo("celular", normalizarCedulaCelular(e.target.value))}
              placeholder="10 dígitos"
              className="font-mono tracking-wider"
            />
            {erroresVisibles.celular ? (
              <p className="text-xs text-destructive">{erroresVisibles.celular}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cliente-correo">Correo (opcional)</Label>
            <Input
              id="cliente-correo"
              type="email"
              autoComplete="email"
              maxLength={150}
              value={valores.correo}
              disabled={guardando}
              onChange={(e) => actualizarCampo("correo", e.target.value)}
            />
            {erroresVisibles.correo ? (
              <p className="text-xs text-destructive">{erroresVisibles.correo}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cliente-direccion">Dirección (opcional)</Label>
            <Textarea
              id="cliente-direccion"
              rows={3}
              value={valores.direccion}
              disabled={guardando}
              onChange={(e) => actualizarCampo("direccion", e.target.value)}
            />
            {erroresVisibles.direccion ? (
              <p className="text-xs text-destructive">{erroresVisibles.direccion}</p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={handleCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {modo === "crear" ? "Registrar cliente" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
