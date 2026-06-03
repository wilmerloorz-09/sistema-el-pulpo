import CampanasPromocionalesCrud from "@/components/admin/CampanasPromocionalesCrud";

const AdminCampanas = () => (
  <div className="px-2.5 pb-8 pt-2 sm:px-4">
    <div className="mb-4">
      <h1 className="font-display text-2xl font-bold text-foreground">Campañas promocionales</h1>
      <p className="text-sm text-muted-foreground">
        Configura predicciones, cartelera de ofertas y cierre de eventos para cupones de descuento.
      </p>
    </div>
    <CampanasPromocionalesCrud />
  </div>
);

export default AdminCampanas;
