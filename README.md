# Nono Mail Cleaner

Limpiador de bandeja de entrada de Gmail con panel web local. Clasifica los correos
en dos capas — heurísticas por expresión regular y un LLM local vía [Ollama](https://ollama.com) —
y mueve a la papelera solo lo que ambas coinciden en marcar como ruido.

Todo el procesamiento del contenido de los correos ocurre en tu máquina. Ningún
asunto ni cuerpo de correo sale hacia un servicio externo de IA.

## Cómo funciona

Son tres piezas:

- **`server.js`** — servidor Node sin dependencias externas (solo módulos nativos). Orquesta
  el escaneo, la clasificación y las acciones. Escucha en `localhost:8765`.
- **`public/index.html`** — panel de control. Recibe eventos en vivo por SSE: log por carriles,
  contadores y métricas de CPU/GPU.
- **`gmail_bridge.example.gs`** — Google Apps Script que se despliega como Web App y es
  lo único que toca Gmail. El servidor local le habla por HTTP con una clave compartida.

No se usa la Gmail API ni OAuth: el acceso va por el puente de Apps Script, que se
ejecuta bajo tu propia cuenta.

### Las dos capas de clasificación

1. **Heurísticas** (`heuristics` en `config.json`). Un patrón `keepOverride` actúa como
   salvavidas: si el correo coincide con banca, factura, recibo, código 2FA o alerta de
   seguridad, se protege pase lo que pase, sin llegar al LLM. Después, los patrones de
   `subject`, `from` y `body` detectan el ruido promocional evidente.
2. **Puntaje del LLM.** El modelo local devuelve un entero de 0 a 100, donde 100 es basura
   segura y 0 es importante. El prompt va en `config.json` y trae ejemplos calibrados.

Encima hay dos protecciones más: `protectConversations` detecta hilos reales de conversación
cruzando los participantes contra `myAddresses`, y `senders.json` guarda reglas manuales
(`protect` / `delete`) por remitente.

## Instalación

Requisitos: Node.js 18+ (por `fetch` nativo) y Ollama corriendo localmente.

```bash
git clone https://github.com/nonoskygt/nono-mail-cleaner.git
cd nono-mail-cleaner

cp config.example.json config.json
cp senders.example.json senders.json

ollama pull qwen3:8b
```

### Desplegar el bridge

1. Abrí [script.google.com](https://script.google.com) y creá un proyecto nuevo.
2. Pegá el contenido de `gmail_bridge.example.gs`.
3. **Cambiá `API_KEY` por una cadena aleatoria larga.** El script se niega a arrancar
   mientras siga en `CHANGE_ME_TO_SOMETHING_SECURE`.
4. *Deploy* → *New Deployment* → *Web App*, con *Execute as: Me* y *Who has access: Anyone*.
5. Copiá la URL `/exec` resultante y la clave a tu `config.json` local
   (campos `gmailBridge` y `gmailKey`).

Luego:

```bash
node server.js
```

Y abrí <http://localhost:8765>.

## Seguridad

> [!WARNING]
> El Web App se despliega con acceso `Anyone` y se ejecuta bajo tu cuenta. **La `API_KEY`
> es lo único que protege tu buzón.** Quien tenga la URL `/exec` y esa clave puede leer,
> enviar, responder, archivar, borrar tus correos y descargar adjuntos.

En consecuencia:

- Usá una clave larga y de alta entropía. Mejor aún: leela desde
  `PropertiesService.getScriptProperties()` en vez de dejarla en el código.
- `config.json`, `senders.json` y `logs/` están en el `.gitignore` y **no deben versionarse
  nunca**. Contienen, respectivamente, la clave y la URL del bridge, correos reales de
  terceros, y un volcado de asuntos y remitentes de tu bandeja.
- Si alguna vez commiteás la clave por error, rotarla no basta con borrar el commit:
  hay que generar una clave nueva **y un despliegue nuevo**, y archivar el anterior para
  que la URL vieja deje de responder.

## Uso

El panel permite escanear remitentes, correr una pasada automática con nivel de dureza
configurable, borrar por remitente y desuscribirse en masa. Casi todas las acciones aceptan
**`dryRun`**, que registra lo que haría sin tocar el buzón. Empezá siempre por ahí.

## Licencia

El código propio de este repositorio no lleva licencia declarada: todos los derechos reservados.
Si querés abrirlo, añadí un archivo `LICENSE`.

`gmail_bridge.example.gs` deriva del Gmail Bridge de [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)
(Mintplex Labs Inc.), bajo licencia MIT. Ver [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
