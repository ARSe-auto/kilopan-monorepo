import type { Page } from "@playwright/test";

// AC-SEC-05: el secreto de dispositivo vive en IndexedDB (kilopan_dispositivo/identidad),
// no en localStorage — sembrar el mismo almacén que lee
// src/identidad/cliente/dispositivo.ts, para simular un equipo ya vinculado.
//
// `page.addInitScript()` solo espera a que el script quede REGISTRADO, no a que su
// promesa (la escritura async en IndexedDB) termine de ejecutarse — un `page.goto()`
// inmediatamente después corre en carrera con la escritura y el equipo llega a
// /ingresar todavía "no vinculado". Por eso se navega primero a una página liviana del
// mismo origen y se siembra con `page.evaluate()`, que Playwright SÍ espera a que
// resuelva antes de continuar.
export async function sembrarDispositivo(
  page: Page,
  dispositivo: { id: string; secreto: string; nombre: string }
) {
  await page.goto("/vincular");
  await page.evaluate((d) => {
    return new Promise<void>((resolver, rechazar) => {
      const req = indexedDB.open("kilopan_dispositivo", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("identidad")) {
          req.result.createObjectStore("identidad");
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("identidad", "readwrite");
        tx.objectStore("identidad").put(d, "actual");
        tx.oncomplete = () => {
          db.close();
          resolver();
        };
        tx.onerror = () => rechazar(tx.error);
      };
      req.onerror = () => rechazar(req.error);
    });
  }, dispositivo);
}
