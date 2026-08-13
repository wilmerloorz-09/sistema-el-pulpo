import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  GlassWater,
  ImageIcon,
  Loader2,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  UserRound,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CLIENTE_FORMULARIO_VACIO,
  CLIENTE_SEXO_OPCIONES,
  type ClienteFormularioValores,
  type ClienteSexo,
} from "@/types/cliente";
import {
  clienteFormularioEsValido,
  normalizarCedulaCelular,
  normalizarNombresApellidos,
  validarClienteFormulario,
} from "@/lib/clientesValidacion";
import {
  buscarClienteAutopedidoQr,
  crearOrdenAutopedidoQr,
  obtenerMenuAutopedidoQr,
  obtenerModificadoresAutopedidoQr,
  registrarClienteAutopedidoQr,
  resolverContextoTokenQr,
  type ContextoTokenQr,
  type MenuNodeAutopedido,
  type ModificadorAutopedido,
} from "@/services/autopedidosQrDb";

type Step = "identidad" | "menu" | "producto" | "carrito" | "exito";

type CartItem = {
  key: string;
  menuNodeId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifierIds: string[];
  modifierNames: string[];
  itemNote: string;
  imageUrl: string | null;
};

function normalizeCategoryLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function fallbackCategoryIcon(name: string): LucideIcon {
  const normalized = normalizeCategoryLabel(name);
  if (normalized.includes("PLATO")) return UtensilsCrossed;
  if (normalized.includes("BEBIDA")) return GlassWater;
  if (normalized.includes("VARIO")) return Package;
  return ImageIcon;
}

function CategoryTabVisual({
  name,
  imageUrl,
  icon,
}: {
  name: string;
  imageUrl?: string | null;
  icon?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = imageUrl?.trim() || "";
  const emoji = icon?.trim() || "";

  if (url && !imageFailed) {
    return (
      <img
        src={url}
        alt=""
        className="h-7 w-7 rounded-lg object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }

  if (emoji) {
    return <span className="text-lg leading-none">{emoji}</span>;
  }

  const FallbackIcon = fallbackCategoryIcon(name);
  return <FallbackIcon className="h-5 w-5 shrink-0" aria-hidden />;
}

function ProductPhoto({
  name,
  imageUrl,
  icon,
  className,
}: {
  name: string;
  imageUrl?: string | null;
  icon?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-orange-50 ring-1 ring-orange-200/70",
        className,
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
      ) : icon ? (
        <span className="text-[1.65rem] leading-none">{icon}</span>
      ) : (
        <ImageIcon className="h-1/2 w-1/2 text-muted-foreground/50" />
      )}
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function resolveAncestorIds(
  nodeId: string,
  parentByNodeId: Map<string, string | null>,
): string[] {
  const ids: string[] = [nodeId];
  let current: string | null | undefined = nodeId;
  const guard = new Set<string>();
  while (current) {
    if (guard.has(current)) break;
    guard.add(current);
    const parent = parentByNodeId.get(current) ?? null;
    if (!parent) break;
    ids.push(parent);
    current = parent;
  }
  return ids;
}

export default function QrPedido() {
  const { token = "" } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>("identidad");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [contexto, setContexto] = useState<ContextoTokenQr | null>(null);
  const [menuNodes, setMenuNodes] = useState<MenuNodeAutopedido[]>([]);
  const [modLinks, setModLinks] = useState<ModificadorAutopedido[]>([]);

  const [cedula, setCedula] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [clienteNombre, setClienteNombre] = useState<string | null>(null);
  const [showRegistro, setShowRegistro] = useState(false);
  const [formCliente, setFormCliente] = useState<ClienteFormularioValores>(CLIENTE_FORMULARIO_VACIO);
  const [identidadError, setIdentidadError] = useState<string | null>(null);
  const [identidadLoading, setIdentidadLoading] = useState(false);

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<MenuNodeAutopedido | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [productQty, setProductQty] = useState(1);
  const [itemNote, setItemNote] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setBootLoading(true);
      setBootError(null);
      try {
        if (!token.trim()) throw new Error("Código QR incompleto.");
        const ctx = await resolverContextoTokenQr(token);
        const [menu, mods] = await Promise.all([
          obtenerMenuAutopedidoQr(token),
          obtenerModificadoresAutopedidoQr(token),
        ]);
        if (cancelled) return;
        setContexto(ctx);
        setMenuNodes(menu);
        setModLinks(mods);
        const roots = menu
          .filter((n) => n.node_type === "category" && !n.parent_id)
          .sort((a, b) => a.display_order - b.display_order);
        setActiveCategoryId(roots[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) {
          setBootError(err instanceof Error ? err.message : "No se pudo abrir el autopedido.");
        }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const parentByNodeId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const node of menuNodes) map.set(node.id, node.parent_id);
    return map;
  }, [menuNodes]);

  const categories = useMemo(
    () =>
      menuNodes
        .filter((n) => n.node_type === "category" && !n.parent_id)
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)),
    [menuNodes],
  );

  const productsInCategory = useMemo(() => {
    if (!activeCategoryId) return [];
    return menuNodes
      .filter(
        (n) =>
          n.node_type === "product" &&
          (n.parent_id === activeCategoryId ||
            resolveAncestorIds(n.id, parentByNodeId).includes(activeCategoryId)),
      )
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }, [activeCategoryId, menuNodes, parentByNodeId]);

  const productModifiers = useMemo(() => {
    if (!selectedProduct) return [];
    const ancestorIds = resolveAncestorIds(selectedProduct.id, parentByNodeId);
    const byId = new Map<string, ModificadorAutopedido>();
    for (const link of modLinks) {
      if (!ancestorIds.includes(link.menu_node_id)) continue;
      if (!byId.has(link.modifier_id)) byId.set(link.modifier_id, link);
    }
    return Array.from(byId.values()).sort(
      (a, b) => a.display_order - b.display_order || a.modifier_name.localeCompare(b.modifier_name),
    );
  }, [selectedProduct, modLinks, parentByNodeId]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const handleBuscarCedula = async () => {
    setIdentidadError(null);
    const clean = normalizarCedulaCelular(cedula);
    if (clean.length !== 10) {
      setIdentidadError("La cédula debe tener exactamente 10 dígitos.");
      return;
    }
    setIdentidadLoading(true);
    try {
      const found = await buscarClienteAutopedidoQr(token, clean);
      if (found) {
        setClienteId(found.id);
        setClienteNombre(`${found.nombres} ${found.apellidos}`.trim());
        setShowRegistro(false);
        setStep("menu");
      } else {
        setShowRegistro(true);
        setFormCliente({
          ...CLIENTE_FORMULARIO_VACIO,
          cedula: clean,
        });
      }
    } catch (err) {
      setIdentidadError(err instanceof Error ? err.message : "No se pudo buscar la cédula.");
    } finally {
      setIdentidadLoading(false);
    }
  };

  const handleRegistrarCliente = async () => {
    setIdentidadError(null);
    const errores = validarClienteFormulario(formCliente);
    if (!clienteFormularioEsValido(errores)) {
      setIdentidadError(Object.values(errores)[0] || "Revisa el formulario.");
      return;
    }
    setIdentidadLoading(true);
    try {
      const id = await registrarClienteAutopedidoQr({
        tokenSeguro: token,
        cedula: normalizarCedulaCelular(formCliente.cedula),
        nombres: formCliente.nombres.trim(),
        apellidos: formCliente.apellidos.trim(),
        celular: normalizarCedulaCelular(formCliente.celular),
        sexo: formCliente.sexo,
        correo: formCliente.correo.trim() || null,
      });
      setClienteId(id);
      setClienteNombre(`${formCliente.nombres} ${formCliente.apellidos}`.trim());
      setStep("menu");
    } catch (err) {
      setIdentidadError(err instanceof Error ? err.message : "No se pudo registrar.");
    } finally {
      setIdentidadLoading(false);
    }
  };

  const openProduct = (product: MenuNodeAutopedido) => {
    setSelectedProduct(product);
    setSelectedModifiers([]);
    setProductQty(1);
    setItemNote("");
    setStep("producto");
  };

  const addToCart = () => {
    if (!selectedProduct) return;
    const price = Number(selectedProduct.price ?? 0);
    if (price <= 0 && !selectedProduct.manual_price_enabled) {
      setSubmitError(`"${selectedProduct.name}" no tiene precio configurado.`);
      return;
    }
    const modifierNames = productModifiers
      .filter((m) => selectedModifiers.includes(m.modifier_id))
      .map((m) => m.modifier_name);
    const key = `${selectedProduct.id}|${selectedModifiers.slice().sort().join(",")}|${itemNote.trim()}`;
    setCart((prev) => {
      const existing = prev.find((p) => p.key === key);
      if (existing) {
        return prev.map((p) =>
          p.key === key ? { ...p, quantity: p.quantity + productQty } : p,
        );
      }
      return [
        ...prev,
        {
          key,
          menuNodeId: selectedProduct.id,
          name: selectedProduct.name,
          unitPrice: price,
          quantity: productQty,
          modifierIds: selectedModifiers.slice(),
          modifierNames,
          itemNote: itemNote.trim(),
          imageUrl: selectedProduct.image_url,
        },
      ];
    });
    setSubmitError(null);
    setStep("menu");
  };

  const updateCartQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + delta } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (cart.length === 0) {
      setSubmitError("Agrega al menos un producto.");
      return;
    }
    setSubmitLoading(true);
    try {
      await crearOrdenAutopedidoQr({
        tokenSeguro: token,
        clienteId,
        items: cart.map((item) => ({
          menu_node_id: item.menuNodeId,
          quantity: item.quantity,
          item_note: item.itemNote || null,
          unit_price: item.unitPrice,
          modifier_ids: item.modifierIds,
        })),
      });
      setCart([]);
      setStep("exito");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "No se pudo enviar el pedido.");
    } finally {
      setSubmitLoading(false);
    }
  };

  if (bootLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-orange-50 px-4 pt-safe">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (bootError || !contexto) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-orange-50 px-4 pt-safe">
        <div className="w-full max-w-md rounded-3xl border border-destructive/30 bg-white p-6 text-center shadow-sm">
          <p role="alert" className="text-sm font-medium text-destructive">
            {bootError || "No disponible"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col bg-gradient-to-b from-orange-50 via-white to-amber-50 pt-safe",
        step === "producto" ? "h-dvh overflow-hidden" : "min-h-dvh",
      )}
    >
      <header className="sticky top-0 z-20 shrink-0 border-b border-orange-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-base font-black text-foreground">
              {contexto.sucursal_nombre}
            </p>
            <p className="text-xs font-semibold text-muted-foreground">{contexto.mesa_nombre}</p>
          </div>
          {step !== "identidad" && step !== "exito" ? (
            <button
              type="button"
              onClick={() => setStep("carrito")}
              className="relative inline-flex h-11 min-w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-primary"
              aria-label="Ver carrito"
            >
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                  {cartCount}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </header>

      <main
        className={cn(
          "flex-1 px-4 py-4",
          step === "producto"
            ? "flex min-h-0 flex-col pb-0"
            : "pb-[calc(1rem+env(safe-area-inset-bottom,0px))]",
        )}
      >
        {step === "identidad" ? (
          <section className="space-y-4">
            <div className="rounded-3xl border border-orange-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-primary">
                  <UserRound className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="font-display text-xl font-black">Identificación</h1>
                  <p className="text-sm text-muted-foreground">Opcional. Puedes omitir este paso.</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cedula">Cédula</Label>
                <Input
                  id="cedula"
                  inputMode="numeric"
                  value={cedula}
                  onChange={(e) => setCedula(normalizarCedulaCelular(e.target.value))}
                  placeholder="10 dígitos"
                  className="h-12 rounded-2xl text-base"
                />
              </div>

              {identidadError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {identidadError}
                </p>
              ) : null}

              <div className="mt-4 grid gap-2">
                <Button
                  type="button"
                  className="h-12 rounded-2xl font-bold"
                  disabled={identidadLoading}
                  onClick={() => void handleBuscarCedula()}
                >
                  {identidadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continuar"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 rounded-2xl"
                  disabled={identidadLoading}
                  onClick={() => {
                    setClienteId(null);
                    setClienteNombre(null);
                    setStep("menu");
                  }}
                >
                  Omitir y pedir sin registro
                </Button>
              </div>
            </div>

            {showRegistro ? (
              <div className="space-y-3 rounded-3xl border border-orange-200 bg-white p-5 shadow-sm">
                <h2 className="font-display text-lg font-black">Registro rápido</h2>
                <div className="space-y-2">
                  <Label>Nombres</Label>
                  <Input
                    className="h-12 rounded-2xl"
                    value={formCliente.nombres}
                    onChange={(e) =>
                      setFormCliente((f) => ({
                        ...f,
                        nombres: normalizarNombresApellidos(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Apellidos</Label>
                  <Input
                    className="h-12 rounded-2xl"
                    value={formCliente.apellidos}
                    onChange={(e) =>
                      setFormCliente((f) => ({
                        ...f,
                        apellidos: normalizarNombresApellidos(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Teléfono</Label>
                  <Input
                    className="h-12 rounded-2xl"
                    inputMode="numeric"
                    value={formCliente.celular}
                    onChange={(e) =>
                      setFormCliente((f) => ({
                        ...f,
                        celular: normalizarCedulaCelular(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Correo (opcional)</Label>
                  <Input
                    className="h-12 rounded-2xl"
                    type="email"
                    value={formCliente.correo}
                    onChange={(e) => setFormCliente((f) => ({ ...f, correo: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sexo</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {CLIENTE_SEXO_OPCIONES.map((op) => (
                      <button
                        key={op.value}
                        type="button"
                        className={cn(
                          "h-12 rounded-2xl border text-sm font-bold",
                          formCliente.sexo === op.value
                            ? "border-primary bg-orange-50 text-primary"
                            : "border-orange-100 bg-white text-muted-foreground",
                        )}
                        onClick={() =>
                          setFormCliente((f) => ({ ...f, sexo: op.value as ClienteSexo }))
                        }
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  className="h-12 w-full rounded-2xl font-bold"
                  disabled={identidadLoading}
                  onClick={() => void handleRegistrarCliente()}
                >
                  {identidadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar y ver menú"}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {step === "menu" ? (
          <section className="space-y-4">
            {clienteNombre ? (
              <p className="text-sm text-muted-foreground">
                Hola, <span className="font-semibold text-foreground">{clienteNombre}</span>
              </p>
            ) : null}

            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategoryId(cat.id)}
                  className={cn(
                    "flex h-12 shrink-0 items-center gap-2 rounded-2xl border px-3 text-sm font-bold",
                    activeCategoryId === cat.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-orange-200 bg-white text-foreground",
                  )}
                >
                  <CategoryTabVisual
                    name={cat.name}
                    imageUrl={cat.image_url}
                    icon={cat.icon}
                  />
                  {cat.name}
                </button>
              ))}
            </div>

            <div className="grid gap-3">
              {productsInCategory.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => openProduct(product)}
                  className="flex min-h-[4.5rem] items-center gap-3 rounded-3xl border border-orange-200 bg-white p-3 text-left shadow-sm"
                >
                  <ProductPhoto
                    name={product.name}
                    imageUrl={product.image_url}
                    icon={product.icon}
                    className="h-16 w-16 rounded-[1.1rem]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-black text-foreground">{product.name}</p>
                    <p className="text-sm font-semibold text-primary">
                      {formatMoney(Number(product.price ?? 0))}
                    </p>
                  </div>
                  <Plus className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {productsInCategory.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-orange-200 px-4 py-8 text-center text-sm text-muted-foreground">
                  No hay productos en esta categoría.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {step === "producto" && selectedProduct ? (
          <section className="flex min-h-0 flex-1 flex-col">
            <button
              type="button"
              onClick={() => setStep("menu")}
              className="mb-2 inline-flex h-9 shrink-0 items-center gap-1 text-sm font-semibold text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> Volver al menú
            </button>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-orange-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <ProductPhoto
                  name={selectedProduct.name}
                  imageUrl={selectedProduct.image_url}
                  icon={selectedProduct.icon}
                  className="h-14 w-14 rounded-2xl"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-black leading-tight">{selectedProduct.name}</h2>
                  <p className="mt-0.5 text-base font-bold text-primary">
                    {formatMoney(Number(selectedProduct.price ?? 0))}
                  </p>
                </div>
              </div>

              {productModifiers.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
                    Modificaciones
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {productModifiers.map((mod) => {
                      const checked = selectedModifiers.includes(mod.modifier_id);
                      return (
                        <button
                          key={mod.modifier_id}
                          type="button"
                          onClick={() =>
                            setSelectedModifiers((prev) =>
                              checked
                                ? prev.filter((id) => id !== mod.modifier_id)
                                : [...prev, mod.modifier_id],
                            )
                          }
                          className={cn(
                            "flex min-h-10 items-center justify-between gap-1 rounded-xl border px-2.5 py-1.5 text-left text-xs font-semibold leading-tight",
                            checked
                              ? "border-primary bg-orange-50 text-primary"
                              : "border-orange-100 bg-white text-foreground",
                          )}
                        >
                          <span className="line-clamp-2">{mod.modifier_name}</span>
                          {checked ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 space-y-1.5">
                <Label htmlFor="nota">Nota (opcional)</Label>
                <Input
                  id="nota"
                  className="h-10 rounded-2xl"
                  value={itemNote}
                  onChange={(e) => setItemNote(e.target.value)}
                  placeholder="Ej. poco picante"
                />
              </div>
            </div>

            <div className="shrink-0 border-t border-orange-100 bg-gradient-to-b from-white to-amber-50/80 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-white"
                    onClick={() => setProductQty((q) => Math.max(1, q - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-8 text-center text-lg font-black">{productQty}</span>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-white"
                    onClick={() => setProductQty((q) => q + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <Button type="button" className="h-11 flex-1 rounded-2xl font-bold" onClick={addToCart}>
                  Agregar
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {step === "carrito" ? (
          <section className="space-y-4">
            <button
              type="button"
              onClick={() => setStep("menu")}
              className="inline-flex h-11 items-center gap-1 text-sm font-semibold text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> Seguir pidiendo
            </button>

            <div className="rounded-3xl border border-orange-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-display text-xl font-black">Tu pedido</h2>
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground">El carrito está vacío.</p>
              ) : (
                <ul className="space-y-3">
                  {cart.map((item) => (
                    <li key={item.key} className="border-b border-orange-50 pb-3 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <ProductPhoto
                          name={item.name}
                          imageUrl={item.imageUrl}
                          className="mt-0.5 h-12 w-12 rounded-xl"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground">{item.name}</p>
                          {item.modifierNames.length ? (
                            <p className="text-xs text-muted-foreground">
                              {item.modifierNames.join(", ")}
                            </p>
                          ) : null}
                          <p className="text-sm text-primary">
                            {formatMoney(item.unitPrice * item.quantity)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center rounded-2xl border"
                            onClick={() => updateCartQty(item.key, -1)}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="min-w-6 text-center font-black">{item.quantity}</span>
                          <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center rounded-2xl border"
                            onClick={() => updateCartQty(item.key, 1)}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-orange-100 pt-3">
                <span className="font-bold">Total</span>
                <span className="font-display text-xl font-black text-primary">
                  {formatMoney(cartTotal)}
                </span>
              </div>

              {submitError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {submitError}
                </p>
              ) : null}

              <Button
                type="button"
                className="mt-4 h-12 w-full rounded-2xl font-bold"
                disabled={submitLoading || cart.length === 0}
                onClick={() => void handleSubmit()}
              >
                {submitLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar pedido"}
              </Button>
            </div>
          </section>
        ) : null}

        {step === "exito" ? (
          <section className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-emerald-200 bg-white px-6 py-12 text-center shadow-sm">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check className="h-8 w-8" />
            </div>
            <h2 className="font-display text-2xl font-black text-foreground">Pedido enviado</h2>
            <p className="text-sm text-muted-foreground">
              Tu pedido quedó pendiente de aprobación del personal en {contexto.mesa_nombre}.
            </p>
            <Button
              type="button"
              className="mt-2 h-12 rounded-2xl px-6 font-bold"
              onClick={() => setStep("menu")}
            >
              Pedir algo más
            </Button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
