import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearTed } from "./ted.ts";

// AC-DTE-03. El escaneo del PDF417 es una mejora progresiva sobre la captura manual: lo
// que se prueba acá es el parser del TED, el núcleo que convierte el XML escaneado en los
// campos tipo+folio+RUT+monto. El apretón de la cámara (BrowserPDF417Reader) es una capa
// delgada sobre esto; si el timbre no parsea, la UI cae de vuelta al ingreso manual.

// TED realista de una guía de despacho (tipo 52), con el mismo shape que emite el SII:
// <DD> con RE/TD/F/FE/RR/RSR/MNT y la firma <FRMT>. Se recorta el CAF por brevedad.
const TED_GUIA = `<TED version="1.0"><DD><RE>76192083-9</RE><TD>52</TD><F>2456</F><FE>2026-08-07</FE><RR>76543210-K</RR><RSR>Panaderia Ejemplo SpA</RSR><MNT>25000</MNT><IT1>Marraqueta</IT1><CAF version="1.0"><DA><RE>76192083-9</RE><RS>KILOPAN</RS><TD>52</TD><RNG><D>1</D><H>5000</H></RNG></DA></CAF><TSTED>2026-08-07T09:14:22</TSTED></DD><FRMT algoritmo="SHA1withRSA">abcDEF123==</FRMT></TED>`;

test("parsearTed extrae tipo, folio, RUT emisor, receptor y monto de una guía", () => {
  const d = parsearTed(TED_GUIA);
  assert.equal(d.tipoDte, 52);
  assert.equal(d.folioSii, 2456);
  assert.equal(d.rutEmisor, "76192083-9");
  assert.equal(d.rutReceptor, "76543210-K");
  assert.equal(d.montoTotal, 25000);
  assert.equal(d.tedXml, TED_GUIA);
});

test("parsearTed acepta un TED sin receptor (RR ausente) y deja rutReceptor en null", () => {
  const sinRR = TED_GUIA.replace("<RR>76543210-K</RR>", "");
  const d = parsearTed(sinRR);
  assert.equal(d.rutReceptor, null);
  assert.equal(d.rutEmisor, "76192083-9");
});

test("parsearTed rechaza texto que no es un timbre del SII", () => {
  assert.throws(() => parsearTed("https://ejemplo.cl/algo"), /no es un timbre/);
});

test("parsearTed rechaza un tipo de documento fuera del dominio (33/39/52/61)", () => {
  const raro = TED_GUIA.replace("<TD>52</TD>", "<TD>99</TD>");
  assert.throws(() => parsearTed(raro), /Tipo de documento/);
});

test("parsearTed rechaza un timbre al que le falta el monto", () => {
  const sinMonto = TED_GUIA.replace("<MNT>25000</MNT>", "");
  assert.throws(() => parsearTed(sinMonto), /tipo, folio, RUT o monto/);
});

test("parsearTed rechaza folio y monto no numéricos o en cero", () => {
  assert.throws(() => parsearTed(TED_GUIA.replace("<F>2456</F>", "<F>0</F>")), /Folio/);
  assert.throws(() => parsearTed(TED_GUIA.replace("<MNT>25000</MNT>", "<MNT>0</MNT>")), /Monto/);
});
