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
};

const InventarioModuleShell = ({
  title,
  description,
  icon,
  iconClassName,
  tabs,
  defaultTab,
}: InventarioModuleShellProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabValues = useMemo(() => tabs.map((tab) => tab.value), [tabs]);
  const rawTab = searchParams.get("tab");
  const activeTab = rawTab && tabValues.includes(rawTab) ? rawTab : defaultTab;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-2xl border bg-white shadow-sm",
            iconClassName ?? "border-teal-200 text-teal-700",
          )}
        >
          {icon}
        </div>
        <div>
          <h1 className="font-display text-lg font-bold text-foreground">{title}</h1>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
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
            "grid h-auto w-full gap-1",
            tabs.length === 2 && "grid-cols-2",
            tabs.length === 3 && "grid-cols-3",
            tabs.length >= 4 && "grid-cols-2 sm:grid-cols-4",
          )}
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs sm:text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-4 border-none p-0 outline-none">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default InventarioModuleShell;
