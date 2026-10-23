package com.nonosky.nonimailtools.capturas

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.core.limpiar.Reason
import com.nonosky.nonimailtools.core.limpiar.ScanResult
import com.nonosky.nonimailtools.core.limpiar.SenderScore
import com.nonosky.nonimailtools.core.sync.FolderResult
import com.nonosky.nonimailtools.core.sync.SyncResult
import com.nonosky.nonimailtools.core.sync.SyncTotals
import com.nonosky.nonimailtools.core.sync.Verification
import com.nonosky.nonimailtools.data.Cuenta
import com.nonosky.nonimailtools.data.MotorCifrado
import com.nonosky.nonimailtools.data.Secretos
import com.nonosky.nonimailtools.ops.EstadoEscaneo
import com.nonosky.nonimailtools.ops.EstadoSync
import com.nonosky.nonimailtools.ui.Cascaron
import com.nonosky.nonimailtools.ui.theme.Acento
import com.nonosky.nonimailtools.ui.theme.DulceTheme
import com.nonosky.nonimailtools.ui.theme.Modo
import com.nonosky.nonimailtools.ui.theme.dulce
import com.nonosky.nonimailtools.ui.theme.fondoDulce
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Renders the real screens with fake data into PNG files. Only runs with -Pnmt.shotsDir=… */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-port-xxhdpi")
class CapturasTest {
    @get:Rule val rule = createComposeRule()

    private val dir = File(System.getProperty("nmt.shots.dir") ?: "build/shots")

    @Before fun preparar() {
        Secretos.motor = object : MotorCifrado {
            override fun cifrar(plain: String) = "x:$plain"
            override fun descifrar(blob: String) = blob.removePrefix("x:")
        }
        val app = ApplicationProvider.getApplicationContext<NmtApp>()
        app.ajustes.configurado(true)
        app.cuentas.guardar(null, "ana@gmail.com", "gmail", "imap.gmail.com", 993, "ssl", "", "pw")
        app.cuentas.guardar(null, "ventas@empresa.com", "imap", "mail.empresa.com", 993, "ssl", "", "pw")
        dir.mkdirs()
    }

    private fun escena(nombre: String, modo: Modo, acento: Acento = Acento.Predeterminado, contenido: @androidx.compose.runtime.Composable () -> Unit) {
        rule.setContent {
            DulceTheme(modo, acento, modo == Modo.OSCURO) {
                Box(Modifier.fillMaxSize().fondoDulce(dulce)) { contenido() }
            }
        }
        rule.waitForIdle()
        rule.onRoot().captureRoboImage(File(dir, "$nombre.png").path)
    }

    private fun s(email: String, name: String, count: Int, kb: Long, score: Int, reason: Reason, subj: String, unsub: Boolean = false) =
        SenderScore(email, name, count, kb * 1024, listOf(subj), unsub, unsub, score, reason, score)

    private fun app() = ApplicationProvider.getApplicationContext<NmtApp>()



    private fun cargarEscaneo() {
        val a = app()
        val cuenta = a.cuentas.cuentas.value.first()
        a.operaciones.mostrar(
            EstadoEscaneo.Listo(
                cuenta,
                ScanResult(
                    cuenta.email, 4200, 1000, 31,
                    listOf(
                        s("noreply@tienda.com", "Tienda Online", 148, 9200, 95, Reason.PROMOCION, "50% OFF solo hoy", true),
                        s("news@boletin.com", "El Boletín", 62, 3100, 88, Reason.MASIVO_AUTOMATICO, "Lo mejor de la semana", true),
                        s("promo@cine.com", "Cine Plus", 40, 2800, 75, Reason.MASIVO, "Estrenos de octubre", true),
                        s("juan@amigo.com", "Juan Pérez", 12, 340, 15, Reason.PERSONA, "Almuerzo el viernes"),
                        s("alertas@banco.com", "Banco Industrial", 25, 410, 0, Reason.PROTEGIDO, "Estado de cuenta de septiembre"),
                    ),
                    cancelled = false, durationMs = 41000, aiScored = 0,
                ),
            ),
        )
    }

    @Test fun limpiarClaro() { cargarEscaneo(); escena("limpiar-claro", Modo.CLARO) { Cascaron(0) } }

    @Test fun limpiarOscuro() { cargarEscaneo(); escena("limpiar-oscuro", Modo.OSCURO, Acento.of("verde-azulado")) { Cascaron(0) } }

    @Test fun sincronizarResultado() {
        val a = app()
        a.operaciones.mostrar(
            EstadoSync.Listo(
                SyncResult(
                    ok = true, dryRun = false, cancelled = false, overLimit = false, error = null, durationMs = 900_000,
                    folders = listOf(
                        FolderResult("INBOX", "INBOX", 2400, 2100, 300, 300, 0, 412_000_000),
                        FolderResult("[Gmail]/Sent Mail", "Sent", 800, 790, 10, 10, 0, 9_000_000),
                    ),
                    totals = SyncTotals(3200, 2890, 310, 310, 0, 421_000_000),
                    verification = Verification(true, 0, emptyList()),
                ),
                "ana@gmail.com", "ventas@empresa.com",
            ),
        )
        escena("sincronizar-claro", Modo.CLARO, Acento.of("violeta")) { Cascaron(1) }
    }


    @Test fun ajustesClaro() = escena("ajustes-claro", Modo.CLARO) { Cascaron(2) }

    @Test fun ajustesOscuro() = escena("ajustes-oscuro", Modo.OSCURO, Acento.of("ambar")) { Cascaron(2) }
}
