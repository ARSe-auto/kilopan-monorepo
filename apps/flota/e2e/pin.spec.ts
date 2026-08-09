import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PIN } from "../../../packages/nucleo-comun/src/constants.ts";
import { esperaSegundos } from "../src/dominio/pin.ts";
import { verificarPin, fijarPin, desbloquear } from "../src/servidor/pin.ts";
import { con, bdDeTenant, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El PIN y su bloqueo contra la base de verdad [AC-FIDN-06] — §0, §4.3, §5.4 F-D.
//
// La curva y el conteo se prueban puros en `src/dominio/pin.test.ts`, sin cluster ni reloj.
// Acá va lo que esa prueba no puede dar: que el estado SOBREVIVA en la fila, que el argon2id
// verifique de verdad, y —lo que el AC nombra de frente— que en el andén el bloqueo de un
// operario no le cierre el aparato al siguiente.
//
// Va como spec de Playwright y no como unit porque necesita el cluster: es el mismo lugar
// donde `ruteo.spec.ts` asierta contra la BD. Nada de esto pasa por HTTP todavía — el endpoint
// de sesión nace con AC-FIDN-04.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const PIN_BUENO = "4090";
const PIN_MALO = "1357";

let pool: Pool;
const usuarios: Record<string, string> = {};

/** Crea persona + usuario con PIN, y devuelve el id del usuario. */
async function crearOperario(rut: string, nombre: string): Promise<string> {
  const [u] = await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [rut, nombre],
    );
    return c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
      [p!.id],
    );
  });
  await fijarPin(pool, u!.id, PIN_BUENO);
  return u!.id;
}

async function filaDe(usuarioId: string) {
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ intentos: string; bloqueado: string | null }>(
      "select intentos_fallidos::text as intentos, bloqueado_hasta::text as bloqueado from usuarios where id = $1",
      [usuarioId],
    ),
  );
  return { intentos: Number(f!.intentos), bloqueado: f!.bloqueado };
}

test.beforeAll(async () => {
  pool = new Pool({
    host: CLUSTER_LOCAL.host,
    port: CLUSTER_LOCAL.puerto,
    database: BD_A,
    user: ROL_MIGRADOR,
  });
  await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from solicitudes_acceso");
    await c.sql("delete from invitaciones");
    await c.sql("delete from usuarios");
    await c.sql("delete from personas");
  });
  // DOS operarios sobre el mismo andén: es la única forma de probar que el bloqueo es por
  // usuario. Con uno solo, «no bloquea el aparato» sería cierto por no haber a quién bloquear.
  usuarios.a = await crearOperario("12.345.678-5", "Operario A");
  usuarios.b = await crearOperario("20.347.878-K", "Operario B");
});

test.afterAll(async () => {
  await pool?.end();
});

test("[AC-FIDN-06] el PIN se guarda hasheado con argon2id y verifica de verdad", async () => {
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ h: string }>("select pin_hash as h from usuarios where id = $1", [usuarios.a!]),
  );
  expect(f!.h).toMatch(/^\$argon2id\$/);
  expect(f!.h).not.toContain(PIN_BUENO);

  expect((await verificarPin(pool, usuarios.a!, PIN_BUENO)).tipo).toBe("correcto");
  expect((await verificarPin(pool, usuarios.a!, PIN_MALO)).tipo).toBe("incorrecto");
  // Y el acierto dejó el contador en cero de vuelta, en la FILA y no en memoria.
  await verificarPin(pool, usuarios.a!, PIN_BUENO);
  expect((await filaDe(usuarios.a!)).intentos).toBe(0);
});

test("[AC-FIDN-06] los intentos del §0 bloquean AL USUARIO, y el estado queda en la fila", async () => {
  for (let i = 0; i < PIN.intentos_hasta_bloqueo; i++) {
    await verificarPin(pool, usuarios.a!, PIN_MALO);
  }
  const fila = await filaDe(usuarios.a!);
  expect(fila.intentos).toBe(PIN.intentos_hasta_bloqueo);
  expect(fila.bloqueado, "el bloqueo no quedó escrito en la base").not.toBeNull();

  // Bloqueado: ni el PIN correcto entra. El bloqueo es el bloqueo.
  const v = await verificarPin(pool, usuarios.a!, PIN_BUENO);
  expect(v.tipo).toBe("bloqueado");
});

test("[AC-FIDN-06] en el andén, el usuario bloqueado NO le cierra el aparato al siguiente", async () => {
  // EL caso que el AC nombra, y la razón por la que el contador vive en `usuarios` y no en
  // `dispositivos`: en el andén rotan varios sobre el MISMO aparato, y un bloqueo por
  // dispositivo dejaría al turno entero afuera porque uno se equivocó cinco veces.
  expect((await verificarPin(pool, usuarios.a!, PIN_BUENO)).tipo).toBe("bloqueado");
  expect((await verificarPin(pool, usuarios.b!, PIN_BUENO)).tipo).toBe("correcto");
  expect((await filaDe(usuarios.b!)).bloqueado).toBeNull();
});

test("[AC-FIDN-06] el intento durante el bloqueo no empuja el contador ni la espera", async () => {
  const antes = await filaDe(usuarios.a!);
  for (let i = 0; i < 10; i++) await verificarPin(pool, usuarios.a!, PIN_MALO);
  const despues = await filaDe(usuarios.a!);
  expect(despues.intentos, "los golpes durante el bloqueo se contaron").toBe(antes.intentos);
  expect(despues.bloqueado, "los golpes durante el bloqueo corrieron la espera").toBe(antes.bloqueado);
});

test("[AC-FIDN-06] el desbloqueo del dueño reabre el acceso y queda en audit_trail", async () => {
  const auditados = async () => {
    const [f] = await con(BD_A, (c: Conexion) =>
      c.sql<{ n: string }>(
        "select count(*)::text as n from audit_trail where tabla = 'usuarios' and registro_id = $1",
        [usuarios.a!],
      ),
    );
    return Number(f!.n);
  };
  const antes = await auditados();

  await desbloquear(pool, usuarios.a!);

  const fila = await filaDe(usuarios.a!);
  expect(fila.intentos).toBe(0);
  expect(fila.bloqueado).toBeNull();
  expect((await verificarPin(pool, usuarios.a!, PIN_BUENO)).tipo).toBe("correcto");
  // El rastro no lo escribe la función: lo pone el trigger de la tabla (AC-FIDN-01). Así
  // queda auditado cualquier cambio de la fila, no solo el que pase por esta puerta.
  expect(await auditados(), "el desbloqueo no dejó rastro").toBeGreaterThan(antes);
});

test("[AC-FIDN-06] rotar el PIN reabre el acceso y la credencial vieja deja de servir", async () => {
  // El dueño no puede conocer el PIN nuevo (argon2id, jamás en logs), así que rotar y
  // desbloquear son un mismo acto desde el punto de vista del contador.
  for (let i = 0; i < PIN.intentos_hasta_bloqueo; i++) await verificarPin(pool, usuarios.b!, PIN_MALO);
  expect((await verificarPin(pool, usuarios.b!, PIN_BUENO)).tipo).toBe("bloqueado");

  const PIN_NUEVO = "8172";
  await fijarPin(pool, usuarios.b!, PIN_NUEVO);
  expect((await verificarPin(pool, usuarios.b!, PIN_NUEVO)).tipo).toBe("correcto");
  expect((await verificarPin(pool, usuarios.b!, PIN_BUENO)).tipo).toBe("incorrecto");
});

test("[AC-FIDN-06] bloqueos sucesivos esperan cada vez más, según la curva del §0", async () => {
  const usuario = await crearOperario("9.999.999-3", "Operario C");
  const esperas: number[] = [];

  // Reloj EXPLÍCITO en vez del real, y no por comodidad: un test que duerma medio minuto para
  // ver el segundo bloqueo no lo corre nadie dos veces, y uno que mezcle el reloj simulado con
  // el de la máquina se miente solo — la primera versión de esta prueba avanzaba el tiempo
  // para una llamada y volvía al reloj real para las siguientes, así que la racha 2 llegaba
  // con un bloqueo todavía vigente y medía la espera de la racha 1.
  let reloj = new Date();

  for (let racha = 1; racha <= 3; racha++) {
    const desde = reloj;
    for (let i = 0; i < PIN.intentos_hasta_bloqueo; i++) {
      await verificarPin(pool, usuario, PIN_MALO, reloj);
    }
    const { bloqueado } = await filaDe(usuario);
    esperas.push(Math.round((new Date(bloqueado!).getTime() - desde.getTime()) / 1000));
    // Se salta hasta un segundo después de que venza, para que la racha siguiente arranque con
    // el bloqueo ya levantado — que es lo que pasa en la vida cuando el operario vuelve.
    reloj = new Date(new Date(bloqueado!).getTime() + 1000);
  }

  // Contra la constante, no contra los números: si el dueño cambia la curva, este test sigue
  // siendo cierto.
  for (let i = 0; i < esperas.length; i++) {
    expect(esperas[i], `racha ${i + 1}`).toBe(esperaSegundos(i + 1));
  }
  expect(esperas[1]).toBeGreaterThan(esperas[0]!);
  expect(esperas[2]).toBeGreaterThan(esperas[1]!);
});

test("[AC-FIDN-06] un usuario que no existe se ve igual que un PIN equivocado", async () => {
  // Si el veredicto distinguiera «no hay tal usuario» de «PIN malo», el andén sería un
  // oráculo de quién trabaja acá — la misma fuga que la pregunta 10 cerró en la solicitud.
  const v = await verificarPin(pool, "0192f0a0-0000-7000-8000-00000000dead", PIN_BUENO);
  expect(v.tipo).toBe("sin_pin");
});
