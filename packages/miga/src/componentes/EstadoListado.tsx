"use client";

import { useEffect, useState } from "react";
import { superficie, semantico, tipografia, grilla, enfasis } from "../tokens.ts";
import { componente } from "../estructura.ts";

// AC-H0-11: los cuatro estados obligatorios de todo listado. El defecto que cierran no es
// estético: hoy un error de red se ve IDÉNTICO a «no hay nada». El maestro lo dice con el
// caso que importa — el repartidor cuya ruta no carga se va a la casa creyendo que no hay
// reparto. Un listado vacío y un listado que falló son dos hechos opuestos y se veían igual.
//
// Viven en `miga` y no en cada pantalla porque la diferencia entre los cuatro tiene que ser
// la MISMA en toda la app: si cada listado inventa su propio «no hay nada», el operador
// aprende a ignorarlos y volvemos al punto de partida.

// AC-FMIG-10 (§5.7): «skeleton <50 ms, spinner solo >400 ms» estaba escrito en la spec pero
// implementado UNA vez, a mano, adentro de `tarjeta-de-entrega.tsx` (AC-FPOD-22: su propio
// `useState`+`useEffect`+`setTimeout(…, 400)`). Esa pantalla no es de este módulo y no se
// toca acá — pero la regla es de PLATAFORMA, no de una pantalla, y una segunda pantalla que
// la necesite (las de este módulo: panel white-label, «Funciones») no puede volver a
// escribir el mismo temporizador: por eso pasa a vivir acá, una vez, como el resto de Miga.
/** A los `umbralMs` de seguir `cargando`, entrega `true` — nunca antes. El skeleton de
 *  `EstadoCargando` ya está desde el primer render (es CSS, no espera a este hook); esto
 *  es solo la ESCALADA para la carga que de verdad tarda, así nadie mira un skeleton mudo
 *  sin saber si sigue vivo. */
export function useEscaladaDeCarga(cargando: boolean, umbralMs = 400): boolean {
  const [demorado, setDemorado] = useState(false);
  useEffect(() => {
    if (!cargando) {
      setDemorado(false);
      return undefined;
    }
    const temporizador = window.setTimeout(() => setDemorado(true), umbralMs);
    return () => window.clearTimeout(temporizador);
  }, [cargando, umbralMs]);
  return demorado;
}

/** Cargando. Skeleton y no un «Cargando…»: ocupa el lugar de lo que viene, así la pantalla
 *  no salta cuando llega el dato — y se distingue de un vacío de un vistazo, sin leer.
 *
 *  `avisoDemora` es la escalada del §5.7 (par de `useEscaladaDeCarga`, arriba): la pantalla
 *  que quiere el «spinner solo >400 ms» le pasa su propio texto cuando el hook devuelve
 *  `true`, y nada cuando no — omitido, este componente se comporta exactamente como antes
 *  de AC-FMIG-10. */
export function EstadoCargando({ filas = 3, avisoDemora }: { filas?: number; avisoDemora?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div role="status" aria-label="Cargando" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: filas }, (_, i) => (
          <div
            key={i}
            style={{
              // Alto propio del skeleton: reserva el lugar de una fila de listado. No es el
              // botón primario del §0 aunque hoy coincidan — por eso queda como valor local.
              height: 56,
              borderRadius: grilla.radio,
              background: superficie.hairline,
              // Sin animación: `prefers-reduced-motion` obligaría a apagarla igual, y un
              // bloque quieto ya comunica «acá viene algo» sin costar batería en el galpón.
            }}
          />
        ))}
      </div>
      {avisoDemora !== undefined && (
        <p
          role="status"
          data-testid="aviso-demora-carga"
          style={{ margin: 0, color: superficie.textoFaint, fontSize: tipografia.pie.tamano, fontWeight: tipografia.pie.peso }}
        >
          {avisoDemora}
        </p>
      )}
    </div>
  );
}

/** Vacío ACCIONABLE: dice qué pasa y qué hacer. Un «no hay datos» a secas deja al operador
 *  sin salida y es indistinguible de un error para quien no sabe leer la diferencia. */
export function EstadoVacio({ mensaje, accion }: { mensaje: string; accion?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: `${grilla.base}px 0` }}>
      <p
        role="status"
        // AC-H0-08: el tamaño que había acá no pertenecía a la escala tipográfica de
        // Miga — "cuerpo" es el peldaño correcto para texto de mensaje.
        style={{ margin: 0, color: superficie.textoFaint, fontSize: tipografia.cuerpo.tamano, fontWeight: tipografia.cuerpo.peso }}
      >
        {mensaje}
      </p>
      {accion}
    </div>
  );
}

/** Error CON REINTENTAR. El botón es la mitad del estado: sin él, «algo falló» es una
 *  noticia sin salida, y el operador cierra la app en vez de volver a intentar. */
export function EstadoError({ mensaje, alReintentar }: { mensaje: string; alReintentar: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: `${grilla.base}px 0` }}>
      {/* role="alert" y no "status": un error interrumpe al lector de pantalla, un vacío no. */}
      <p
        role="alert"
        // AC-H0-08: mismo peldaño "cuerpo" que el mensaje de EstadoVacio; el peso 600 se
        // mantiene como énfasis propio del error, no del token (mismo patrón que ChipOperador).
        style={{ margin: 0, color: semantico.error, fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.medio }}
      >
        {mensaje}
      </p>
      <button
        type="button"
        onClick={alReintentar}
        style={{
          // El mínimo táctil de la familia canónica (§0/§5), con las manos enharinadas.
          minHeight: componente.objetivoTactil.altoMinPx,
          padding: "0 20px",
          borderRadius: grilla.radio,
          border: `1px solid ${superficie.hairline}`,
          background: superficie.tarjeta,
          color: superficie.texto,
          fontSize: tipografia.cuerpo.tamano,
          fontWeight: enfasis.medio,
          alignSelf: "flex-start",
        }}
      >
        Reintentar
      </button>
    </div>
  );
}
