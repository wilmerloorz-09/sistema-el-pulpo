import { useState } from "react";
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

const ProductPicker = ({ categories, subcategories, products, onSelectProduct }: Props) => {
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? "");
  const [activeSub, setActiveSub] = useState("");

  const filteredSubs = subcategories.filter((s) => s.category_id === activeCat);
  const filteredProducts = products.filter((p) =>
    activeSub ? p.subcategory_id === activeSub : filteredSubs.some((s) => s.id === p.subcategory_id)
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Categories */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => { setActiveCat(cat.id); setActiveSub(""); }}
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

      {/* Subcategories */}
      {filteredSubs.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setActiveSub("")}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              !activeSub ? "bg-secondary text-secondary-foreground" : "bg-muted/50 text-muted-foreground"
            )}
          >
            Todos
          </button>
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
        </div>
      )}

      {/* Products grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {filteredProducts.map((product, i) => (
          <motion.button
            key={product.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => onSelectProduct(product)}
            className="flex flex-col items-start rounded-xl border border-border bg-card p-3 text-left transition-all active:scale-95 hover:border-primary/30"
          >
            <span className="text-sm font-medium text-foreground leading-tight">
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
          <p className="col-span-full text-center text-sm text-muted-foreground py-6">
            Sin productos en esta categoría
          </p>
        )}
      </div>
    </div>
  );
};

export default ProductPicker;
