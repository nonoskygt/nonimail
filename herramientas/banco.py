#!/usr/bin/env python3
"""Banco de pruebas de modelos de NoniMail Tools.

Pasa 24 correos etiquetados por un modelo de Ollama con el prompt por categoría y dice si sirve.
Un modelo solo se ofrece en las apps si acierta TODOS los «bajo» (importantes: personales, 2FA,
seguridad, facturas, banco, pedidos, citas, trámites) y las promociones.

Uso:  OLLAMA_URL=http://127.0.0.1:11434 python3 herramientas/banco.py qwen3.5:2b
El prompt real de las apps está en escritorio/config/defaults.json (llmPrompt) y en
android/core/src/main/resources/.../defaults.json (llm.prompt): si se cambia ahí, cámbielo aquí.
"""
import json, os, sys, time, urllib.request

P = """Clasifique este correo en UNA categoría. Responda solo la palabra.
PERSONAL: lo escribió una persona (amigo, familia, colega, cliente), incluye respuestas "Re:".
TRANSACCION: factura, recibo, pago, estado de cuenta, pedido o envío del usuario, cita, trámite, renovación de un servicio, avisos del gobierno o de impuestos (SAT, declaraciones, municipalidad).
SEGURIDAD: código de verificación, inicio de sesión, alerta de cuenta, cambio de contraseña.
PROMOCION: ofertas, descuentos, cupones, ventas, webinars, encuestas, publicidad.
BOLETIN: newsletter, noticias, novedades, resúmenes.
SOCIAL: notificaciones de redes sociales (invitaciones, likes, seguidores).
OTRO: notificación automática que no encaja arriba.
Una cuenta de empresa que manda un aviso del pedido, pago o cuenta del usuario es TRANSACCION o SEGURIDAD, no PROMOCION.
Si invita a comprar, ofrece descuento, cupón, envío gratis o "solo hoy", es PROMOCION aunque mencione pedidos o envíos."""
MAP = {"PERSONAL":3,"TRANSACCION":10,"SEGURIDAD":3,"PROMOCION":95,"BOLETIN":85,"SOCIAL":85,"OTRO":50}

# (nombre, esperado: 'alto' >=70 | 'bajo' <=30 | 'medio', from, asunto, masivo, cuerpo)
S = [
 ("promo-ropa","alto","Tienda Moda <ofertas@tiendamoda.com>","¡50% OFF solo hoy en toda la tienda!",1,"Compra ahora. Envío gratis. Darse de baja."),
 ("promo-viajes","alto","Club Viajes <news@clubviajes.com>","Cancún desde $199 · ofertas de temporada",1,"Reserve ya. Plazas limitadas. Cancelar suscripción."),
 ("newsletter","alto","Revista Hoy <boletin@revistahoy.com>","Las 10 noticias de la semana",1,"Lea el boletín completo. Ver en navegador."),
 ("red-social","alto","LinkedIn <notifications@linkedin.com>","Tiene 5 invitaciones pendientes",1,"Ana y 4 personas más quieren conectar."),
 ("encuesta","alto","Encuestas <survey@marca.com>","¿Cómo fue su experiencia? Responda en 1 minuto",1,"Su opinión nos importa. Gane un cupón."),
 ("webinar","alto","SaaS Corp <events@saascorp.io>","Webinar gratis: crezca su negocio con IA",1,"Regístrese hoy. Cupos limitados."),
 ("cupon","alto","Cupones GT <promo@cupones.gt>","Su cupón de Q50 vence mañana",1,"Úselo antes del domingo."),
 ("app-promo","alto","Spotify <no-reply@spotify.com>","3 meses de Premium por $0",1,"Oferta por tiempo limitado."),
 ("factura","bajo","Facturación <facturacion@proveedor.com>","Factura electrónica FEL #2026-1182",0,"Adjuntamos su factura por Q1,250.00."),
 ("banco-estado","bajo","Banco Industrial <alertas@bi.com.gt>","Estado de cuenta de octubre",1,"Su estado de cuenta está disponible."),
 ("2fa","bajo","Google <no-reply@accounts.google.com>","Su código de verificación es 482910",0,"No comparta este código."),
 ("alerta-seg","bajo","Microsoft <account-security-noreply@accountprotection.microsoft.com>","Inicio de sesión inusual en su cuenta",0,"Revise la actividad reciente."),
 ("pedido","bajo","Amazon <shipment-tracking@amazon.com>","Su pedido #114-55 fue enviado",1,"Llegará el jueves. Rastree su paquete."),
 ("persona","bajo","Carlos Pérez <carlos.perez@gmail.com>","Re: reunión del jueves",0,"Hola, confirmo la reunión a las 10. ¿Lleva usted la propuesta?"),
 ("persona2","bajo","María López <mlopez@empresa.com.gt>","Cotización que me pidió",0,"Adjunto la cotización. Quedo atenta."),
 ("cita","bajo","Clínica Dental <citas@clinicadental.gt>","Recordatorio: su cita mañana 9:00",0,"Confirme o reprograme respondiendo este correo."),
 ("tramite","bajo","SAT Guatemala <notificaciones@sat.gob.gt>","Notificación de su declaración",0,"Su declaración fue recibida."),
 ("recibo","bajo","PayPal <service@paypal.com>","Recibo de su pago a Netflix",0,"Pagó US$15.49."),
 ("familia","bajo","Mamá <rosa.gonzalez@hotmail.com>","Fotos del cumpleaños",0,"Te mando las fotos, besos."),
 ("ong","medio","Editor ONG <editor@ong.org>","Boletín mensual de activismo",1,"Novedades de nuestra causa."),
 ("router","medio","Router <no-reply@mirouter.com>","Config Created",0,"Se creó una configuración."),
 ("github","medio","GitHub <notifications@github.com>","[repo] Nuevo issue #42",1,"Alguien abrió un issue."),
 ("pedido-promo","medio","Tienda <pedidos@tienda.com>","Gracias por su compra, vea productos similares",1,"Su pedido se entregó. También le puede gustar…"),
 ("proveedor","medio","Hosting <billing@nube.example>","Su servicio se renueva en 7 días",1,"Renovación automática Q300."),
]


def prompt(s):
    return f"{P}\n\nDe: {s[2]}\nAsunto: {s[3]}\nMasivo: {'sí' if s[4] else 'no'}\nTexto: {s[5]}\n\nCategoría:"


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "qwen3.5:2b"
    url = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/") + "/api/generate"
    ok = tot = 0
    for s in S:
        body = {"model": model, "prompt": prompt(s), "stream": False, "think": False,
                "options": {"temperature": 0, "num_predict": 8, "num_ctx": 2048}}
        t0 = time.time()
        r = json.loads(urllib.request.urlopen(urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=600).read())
        ms = int((time.time() - t0) * 1000); tot += ms
        txt = (r.get("response") or "").upper().replace("Ó", "O")
        cat = next((k for k in MAP if k in txt), None); sc = MAP.get(cat)
        good = sc is not None and ((s[1] == "alto" and sc >= 70) or (s[1] == "bajo" and sc <= 30) or s[1] == "medio")
        ok += good
        print(f"{s[0]:13} esp={s[1]:5} {str(cat):12} {'OK' if good else 'MAL'} {ms}ms", flush=True)
    print(f"== {model}: {ok}/{len(S)} · promedio {tot // len(S)} ms")


if __name__ == "__main__":
    main()
