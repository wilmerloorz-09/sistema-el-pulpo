import React from "react";
import ShiftSetupAdmin from "@/components/admin/ShiftSetupAdmin";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

class TurnoErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || "Error al cargar la configuracion del turno.",
    };
  }

  componentDidCatch(error: Error) {
    console.error("Turno module crashed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-3">
              <p className="font-semibold">No se pudo cargar la pantalla de turno.</p>
              <p className="text-xs">{this.state.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => this.setState({ hasError: false, message: "" })}
              >
                Reintentar
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const Turno = () => {
  return (
    <div className="space-y-4 p-2.5 sm:p-4">
      <div className="mt-3">
        <TurnoErrorBoundary>
          <ShiftSetupAdmin />
        </TurnoErrorBoundary>
      </div>
    </div>
  );
};

export default Turno;
