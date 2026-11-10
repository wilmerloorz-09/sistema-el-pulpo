import type { ReactNode } from "react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type InventarioTabDef = {
  value: string;
  label: string;
  content: ReactNode;
};

type InventarioModuleShellProps = {
  title: string;
  description?: string;
  icon: ReactNode;
  iconClassName?: string;
  tabs: InventarioTabDef[];
  defaultTab: string;
  /** En móvil, pone las pestañas en una sola fila (útil con labels cortos). */
  compactTabs?: boolean;
};

const InventarioModuleShell = ({
  title,
  description,
  icon,
  iconClassName,
  tabs,
  defaultTab,
  compactTabs = false,
}: InventarioModuleShellProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabValues = useMemo(() => tabs.map((tab) => tab.value), [tabs]);
  const rawTab = searchParams.get("tab");
  const activeTab = rawTab && tabValues.includes(rawTab) ? rawTab : defaultTab;

  return (
    <div className="mx-auto max-w-6xl space-y-2.5 p-3 sm:space-y-4 sm:p-6">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl border bg-white shadow-sm sm:h-10 sm:w-10 sm:rounded-2xl",
            iconClassName ?? "border-teal-200 text-teal-700",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-base font-bold leading-tight text-foreground sm:text-lg">{title}</h1>
          {description ? (
            <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{description}</p>
          ) : null}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          next.set("tab", value);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList
          className={cn(
            "grid h-auto w-full gap-1 p-1",
            tabs.length === 2 && "grid-cols-2",
            tabs.length === 3 && "grid-cols-3",
            tabs.length >= 4 && (compactTabs ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"),
          )}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-8 px-1.5 text-[11px] leading-tight sm:h-9 sm:px-3 sm:text-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-2.5 border-none p-0 outline-none sm:mt-4">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default InventarioModuleShell;
