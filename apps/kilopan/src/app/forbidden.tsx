import { superficie } from "@kilopan/miga/tokens.ts";
import { Copyright } from "@kilopan/miga/componentes/index.tsx";
import { Pantalla } from "./Pantalla.tsx";

// AC-ADM-04: la pantalla que Next renderiza cuando un Server Component llama
// `forbidden()` — y la respuesta sale con HTTP 403, no 200. Es el frente visible de que
// el rechazo por rol lo decide el SERVIDOR (ver src/app/arreglar/page.tsx), no un enlace
// escondido en el cliente.
export default function Forbidden() {
  return (
    <Pantalla titulo="Sin permiso" ancho={480}>
      <p style={{ color: superficie.textoDim, fontSize: 15, lineHeight: 1.5 }}>
        Esta pantalla es solo para administradores. Si crees que deberías poder entrar,
        pídele al dueño que revise tu rol.
      </p>
      <Copyright />
    </Pantalla>
  );
}
