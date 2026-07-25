"use client";
// AC-PES-05 (decisión #1, nivel 2): báscula conectada por Web Bluetooth.
//
// ADVERTENCIA HONESTA, no una nota al pie: Web Bluetooth NO existe en Safari/iOS —
// y tampoco en Firefox. En iPhone este camino nunca se ofrece y el ingreso sigue
// siendo manual, que es el único camino garantizado en todo equipo. Por eso la UI
// jamás debe *depender* de esto: es una mejora, no un requisito.
//
// SEGUNDA ADVERTENCIA: este código está escrito contra el perfil de "Weight Scale"
// del estándar Bluetooth GATT (servicio 0x181D, característica 0x2A9D). Muchas
// básculas de panadería chilenas (Toledo, CAS, Torrey) usan protocolos serie
// propietarios, no GATT estándar. **No se pudo probar contra una báscula real en
// este entorno** — dar por validado solo después de conectar una de verdad.

const SERVICIO_PESO = 0x181d;
const CARACTERISTICA_PESO = 0x2a9d;

export function soportaBascula(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export interface LecturaBascula {
  gramos: number;
  estable: boolean;
}

/** Conecta y entrega lecturas hasta que se llame a la función de corte devuelta. */
export async function conectarBascula(
  alLeer: (lectura: LecturaBascula) => void
): Promise<() => void> {
  if (!soportaBascula()) {
    throw new Error("Este equipo no soporta báscula por Bluetooth. Ingresa el peso a mano.");
  }

  const bluetooth = (navigator as Navigator & { bluetooth: BluetoothConfig }).bluetooth;
  const dispositivo = await bluetooth.requestDevice({ filters: [{ services: [SERVICIO_PESO] }] });
  const servidor = await dispositivo.gatt.connect();
  const servicio = await servidor.getPrimaryService(SERVICIO_PESO);
  const caracteristica = await servicio.getCharacteristic(CARACTERISTICA_PESO);

  function alCambiar(evento: Event) {
    const valor = (evento.target as unknown as { value: DataView }).value;
    // Formato GATT Weight Measurement: flags (1 byte) + peso (uint16, little-endian).
    // Bit 0 de flags: 0 = SI (kg, resolución 5 g); 1 = imperial (lb).
    const flags = valor.getUint8(0);
    const crudo = valor.getUint16(1, true);
    const esImperial = (flags & 0x01) === 1;
    const gramos = esImperial ? Math.round(crudo * 0.01 * 453.592) : Math.round(crudo * 5);
    alLeer({ gramos, estable: (flags & 0x02) === 0 });
  }

  caracteristica.addEventListener("characteristicvaluechanged", alCambiar);
  await caracteristica.startNotifications();

  return () => {
    caracteristica.removeEventListener("characteristicvaluechanged", alCambiar);
    void caracteristica.stopNotifications().catch(() => undefined);
    dispositivo.gatt.disconnect();
  };
}

// Tipos mínimos: Web Bluetooth no está en lib.dom de TypeScript.
interface BluetoothConfig {
  requestDevice(opciones: { filters: { services: number[] }[] }): Promise<{
    gatt: {
      connect(): Promise<{
        getPrimaryService(s: number): Promise<{
          getCharacteristic(c: number): Promise<EventTarget & {
            startNotifications(): Promise<void>;
            stopNotifications(): Promise<void>;
          }>;
        }>;
      }>;
      disconnect(): void;
    };
  }>;
}
