import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface Category {
  id: string;
  description: string;
}

interface Subcategory {
  id: string;
  description: string;
  category_id: string;
}

interface Product {
  id: string;
  description: string;
  subcategory_id: string;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
}

interface Props {
  categories: Category[];
  subcategories: Subcategory[];
  products: Product[];
  onSelectProduct: (product: Product) => void;
}

const ALL_SUBCATEGORIES = "__ALL__";

const ProductPicker = ({ categories, subcategories, products, onSelectProduct }: Props) => {
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? "");
  const [activeSub, setActiveSub] = useState("");

  useEffect(() => {
    if (!activeCat && categories[0]?.id) {
      setActiveCat(categories[0].id);
    }
  }, [activeCat, categories]);

  const filteredSubs = useMemo(
    () => subcategories.filter((s) => s.category_id === activeCat),
    [subcategories, activeCat],
  );

  useEffect(() => {
    if (filteredSubs.length === 0) {
      if (activeSub !== "") {
        setActiveSub("");
      }
      return;
    }

    const hasExplicitAll = activeSub === ALL_SUBCATEGORIES;
    const currentExists = filteredSubs.some((sub) => sub.id === activeSub);

    if (!hasExplicitAll && !currentExists) {
      setActiveSub(filteredSubs[0].id);
    }
  }, [filteredSubs, activeSub]);

  const filteredProducts = products.filter((p) => {
    if (activeSub === ALL_SUBCATEGORIES) {
      return filteredSubs.some((s) => s.id === p.subcategory_id);
    }
    return p.subcategory_id === activeSub;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              setActiveCat(cat.id);
              const nextSubs = subcategories.filter((sub) => sub.category_id === cat.id);
              setActiveSub(nextSubs[0]?.id ?? "");
            }}
            className={cn(
              "shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
              activeCat === cat.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {cat.description}
          </button>
        ))}
      </div>

      {filteredSubs.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {filteredSubs.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setActiveSub(sub.id)}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                activeSub === sub.id
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-muted/50 text-muted-foreground"
              )}
            >
              {sub.description}
            </button>
          ))}
          <button
            onClick={() => setActiveSub(ALL_SUBCATEGORIES)}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              activeSub === ALL_SUBCATEGORIES ? "bg-secondary text-secondary-foreground" : "bg-muted/50 text-muted-foreground"
            )}
          >
            Todos
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {filteredProducts.map((product, i) => (
          <motion.button
            key={product.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => onSelectProduct(product)}
            className="flex flex-col items-start rounded-xl border border-border bg-card p-3 text-left transition-all hover:border-primary/30 active:scale-95"
          >
            <span className="text-sm font-medium leading-tight text-foreground">
              {product.description}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {product.price_mode === "MANUAL"
                ? "Precio manual"
                : `$${product.unit_price ?? 0}`}
            </span>
          </motion.button>
        ))}
        {filteredProducts.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
            Sin productos en esta categoria
          </p>
        )}
      </div>
    </div>
  );
};

export default ProductPicker;
