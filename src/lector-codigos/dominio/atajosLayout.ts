export type ProductoAtajo = {
  id: string;
  productId: string;
  nombre: string;
  precio: number;
  imageUrl?: string | null;
  stock: number | null;
};

export type MarcaAtajo = {
  id: string;
  label: string;
  logo: string;
  match: (nombreNormalizado: string) => boolean;
};

export function normalizarNombreProducto(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function esChifle(nombre: string): boolean {
  return normalizarNombreProducto(nombre).includes("chifle");
}

/** Jugos naturales / Club Verde (no gaseosas “Cola Naranja”). */
export function esJugo(nombre: string): boolean {
  const n = normalizarNombreProducto(nombre);
  if (n.includes("cola naranja") || n.includes("cola manzana")) return false;
  return (
    n.includes("jugo")
    || n.includes("club verde")
    || n === "quaker"
    || n.startsWith("quaker ")
  );
}

export const FILA_MARCAS_COCA: MarcaAtajo[] = [
  {
    id: "coca-cola",
    label: "Coca Cola",
    logo: "/lector-codigos/marcas/coca-cola.webp",
    match: (n) => n.includes("coca"),
  },
  {
    id: "fiora",
    label: "Fiora",
    logo: "/lector-codigos/marcas/fiora.jpg",
    match: (n) => n.includes("fiora") || n.includes("fioravanti"),
  },
  {
    id: "fanta",
    label: "Fanta",
    logo: "/lector-codigos/marcas/fanta.png",
    match: (n) => n.includes("fanta"),
  },
  {
    id: "sprite",
    label: "Sprite",
    logo: "/lector-codigos/marcas/sprite.png",
    match: (n) => n.includes("sprite"),
  },
  {
    id: "inca",
    label: "Inca",
    logo: "/lector-codigos/marcas/inca.png",
    match: (n) => n.includes("inca"),
  },
];

export const FILA_MARCAS_PEPSI: MarcaAtajo[] = [
  {
    id: "pepsi",
    label: "Pepsi cola",
    logo: "/lector-codigos/marcas/pepsi.png",
    match: (n) => n.includes("pepsi"),
  },
  {
    id: "tropical",
    label: "Tropical",
    logo: "/lector-codigos/marcas/tropical.png",
    match: (n) => n.includes("tropical"),
  },
  {
    id: "naranja",
    label: "Naranja",
    logo: "/lector-codigos/marcas/naranja.png",
    match: (n) =>
      (n.includes("cola naranja") || n.includes("mirinda") || n.includes("naranja"))
      && !n.includes("jugo"),
  },
  {
    id: "manzana",
    label: "Manzana",
    logo: "/lector-codigos/marcas/manzana.jpg",
    match: (n) => n.includes("manzana") && !n.includes("jugo"),
  },
  {
    id: "7up",
    label: "7up",
    logo: "/lector-codigos/marcas/7up.jpg",
    match: (n) => n.includes("7up") || n.includes("7 up"),
  },
  {
    id: "gallito",
    label: "Gallito",
    logo: "/lector-codigos/marcas/gallito.jpg",
    match: (n) => n.includes("gallito"),
  },
];

export const FILA_OTRAS: MarcaAtajo[] = [
  {
    id: "agua",
    label: "Agua",
    logo: "/lector-codigos/marcas/agua.jpg",
    match: (n) => n === "agua" || n.startsWith("agua "),
  },
  {
    id: "fuze-tea",
    label: "Fuze Tea",
    logo: "/lector-codigos/marcas/fuze-tea.jpg",
    match: (n) => n.includes("fuze"),
  },
  {
    id: "del-valle",
    label: "Del valle",
    logo: "/lector-codigos/marcas/del-valle.jpg",
    match: (n) => n.includes("del valle") || n.includes("delvalle"),
  },
];

export function tieneStock(producto: ProductoAtajo): boolean {
  return (producto.stock ?? 0) > 0;
}

export function productosDeMarca(
  productos: ProductoAtajo[],
  marca: MarcaAtajo,
): ProductoAtajo[] {
  return productos.filter((p) => marca.match(normalizarNombreProducto(p.nombre)));
}

/** Presentaciones de la marca con stock > 0. */
export function productosDeMarcaConStock(
  productos: ProductoAtajo[],
  marca: MarcaAtajo,
): ProductoAtajo[] {
  return productosDeMarca(productos, marca).filter(tieneStock);
}

/** Marcas que tienen al menos una presentación con stock. */
export function marcasConStock(
  marcas: MarcaAtajo[],
  productos: ProductoAtajo[],
): MarcaAtajo[] {
  return marcas.filter((marca) => productosDeMarcaConStock(productos, marca).length > 0);
}

export function productosFila1(
  productos: ProductoAtajo[],
): ProductoAtajo[] {
  const chifle = productos.filter((p) => esChifle(p.nombre));
  const jugosConStock = productos.filter((p) => esJugo(p.nombre) && tieneStock(p));
  const seen = new Set<string>();
  const out: ProductoAtajo[] = [];
  for (const p of [...chiflesUnicos(chifle), ...jugosConStock]) {
    if (seen.has(p.productId)) continue;
    seen.add(p.productId);
    out.push(p);
  }
  return out;
}

/** Accesos directos fijos de la cuarta fila, en este orden. */
export function productosFila4(productos: ProductoAtajo[]): ProductoAtajo[] {
  const objetivos: Array<(nombre: string) => boolean> = [
    (nombre) => nombre === "agua" || nombre.startsWith("agua "),
    (nombre) => nombre === "cafe" || nombre.startsWith("cafe "),
    (nombre) => nombre.includes("fuze tea") || nombre.includes("fuze"),
    (nombre) => nombre.includes("del valle") && nombre.includes("950"),
  ];
  const usados = new Set<string>();
  const resultado: ProductoAtajo[] = [];

  for (const coincide of objetivos) {
    const producto = productos
      .filter((item) => !usados.has(item.productId) && coincide(normalizarNombreProducto(item.nombre)))
      .sort((a, b) => Number(tieneStock(b)) - Number(tieneStock(a)) || a.nombre.localeCompare(b.nombre))[0];
    if (!producto) continue;
    usados.add(producto.productId);
    resultado.push(producto);
  }

  return resultado;
}

function chiflesUnicos(items: ProductoAtajo[]): ProductoAtajo[] {
  // Un solo botón Chifle: el de menor precio / primero del menú.
  if (items.length <= 1) return items;
  return [items.slice().sort((a, b) => a.precio - b.precio || a.nombre.localeCompare(b.nombre))[0]];
}
