"use client";

import { useEffect, useMemo } from "react";
import { tipografia, superficie, semantico as colorSemantico } from "@kilopan/miga/tokens.ts";
import { estadoDeRastreo } from "../../dominio/rastreo.ts";
import { iniciarRastreo } from "../../cliente/rastreo.ts";

// El aviso de rastreo, SIEMPRE visible mientras el turno está abierto [AC-FTEL-01] — §7.8, §11.
//
// NO ES CONFIGURABLE NI REMOVIBLE: no hay botón para cerrarlo, ni ajuste de tenant que lo
// apague. Deja de decir «en ruta» ÚNICAMENTE cuando el turno cierra — el efecto que arranca la
// captura se limpia con el desmontaje o con el cambio de turno, que es exactamente cuándo el
// §7.8 dice que la autorización de rastrear termina.
export function EstadoDeRastreo({ turno }: { turno: { id: string; abiertoEn: string } | null }) {
  const estado = useMemo(() => estadoDeRastreo(turno?.abiertoEn ?? null), [turno?.abiertoEn]);

  useEffect(() => {
    if (!turno) return undefined;
    return iniciarRastreo(turno.id);
  }, [turno?.id]);

  return (
    <p data-testid="rastreo-estado" role="status" style={estilo(estado.rastreando)}>
      {estado.texto}
    </p>
  );
}

const estilo = (rastreando: boolean) => ({
  margin: 0,
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: 600,
  color: rastreando ? colorSemantico.ok : superficie.textoDim,
});
