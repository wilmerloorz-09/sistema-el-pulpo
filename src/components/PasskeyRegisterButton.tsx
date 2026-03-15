import { cloneElement, isValidElement, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { startRegistration } from "@simplewebauthn/browser";
import { toast } from "sonner";

interface PasskeyRegisterButtonProps {
  trigger?: React.ReactNode;
}

const PasskeyRegisterButton = ({ trigger }: PasskeyRegisterButtonProps) => {
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setLoading(true);
    try {
      // 1. Get registration options
      const { data: options, error: optErr } = await supabase.functions.invoke(
        "webauthn-register",
        { body: { action: "options" } }
      );
      if (optErr) throw new Error(optErr.message);

      // 2. Start browser WebAuthn ceremony
      const attestation = await startRegistration({ optionsJSON: options });

      // 3. Verify with server
      const { data: result, error: verErr } = await supabase.functions.invoke(
        "webauthn-register",
        {
          body: {
            action: "verify",
            attestation,
            deviceName: navigator.userAgent.includes("Mobile")
              ? "Dispositivo movil"
              : "Computadora",
          },
        }
      );
      if (verErr) throw new Error(verErr.message);

      if (result.verified) {
        toast.success("Huella registrada correctamente");
      } else {
        toast.error("No se pudo registrar la huella");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        toast.error("Operacion cancelada por el usuario");
      } else {
        toast.error(err.message || "Error al registrar huella");
      }
    } finally {
      setLoading(false);
    }
  };

  if (trigger && isValidElement(trigger)) {
    return cloneElement(trigger, {
      onClick: handleRegister,
      disabled: loading || (trigger.props as { disabled?: boolean }).disabled,
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleRegister}
      disabled={loading}
      title="Registrar huella / passkey"
      className="h-8 w-8"
    >
      <Fingerprint className="h-4 w-4" />
    </Button>
  );
};

export default PasskeyRegisterButton;
