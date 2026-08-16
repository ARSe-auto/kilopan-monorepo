# Exenciones de la suite HTTP A-contra-B

Rutas del manifiesto (`rutas/manifiesto.json`) que **no** llevan caso de cruce generado, con
su justificación **escrita**. Es el archivo versionado que exige AC-FTEN-26 (§9.2, centinela
2 del §9.3): la cobertura es TOTAL, y lo único que puede quedar fuera es lo que alguien se
haya tomado el trabajo de justificar acá, por escrito y con su nombre en el `git blame`.

`rutas/generar.mjs` las **cuenta** y las imprime en cada corrida del gate, y emite el total
como artefacto del pipeline (`packages/metodo/panel/exenciones-rutas.json`, con histórico
por commit en `.historico.jsonl`) para que el panel del §10 dibuje la tendencia. **Tendencia
creciente = bandera roja**: cada exención nueva es una ruta que dejó de estar probada contra
el cruce de tenants, y el número existe para que eso duela a la vista.

## Formato

Una por línea, así — la ruta entre acentos graves, raya, y la justificación en prosa:

```
- `/api/lo-que-sea` — por qué esta ruta no puede llevar el caso de cruce, con el detalle
  concreto que lo hace imposible y qué tendría que cambiar para que deje de estar exenta.
```

El gate rebota, y no como aviso sino en rojo:

- una justificación de menos de 40 caracteres — «n/a», «por ahora», «no aplica» no son
  justificaciones: son la exención sin justificar que el AC veta;
- una exención de una ruta que **no existe** en el manifiesto — una exención muerta no tapa
  nada suyo, pero queda de pantalla para la que sí;
- una ruta que está exenta **y** además tiene `cruce` declarado — la exención gana en
  silencio y el caso declarado no se corre nunca.

## Exenciones vigentes

<!-- Ninguna. Las rutas que hay (`/` y `/api/tenant`) llevan su caso de cruce declarado en
     rutas/manifiesto.json. Mientras esta sección esté vacía, el contador vale 0 y la
     cobertura de la suite es total. -->
