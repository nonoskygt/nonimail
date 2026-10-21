package com.nonosky.nonimailtools.core.licencias

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DominiosTest {
    @Test fun publicDomainsArePersonal() {
        for (e in listOf("a@gmail.com", "A@GMAIL.COM", "a@icloud.com", "a@proton.me", "a@qq.com")) assertTrue(e, Dominios.esPersonal(e))
    }

    @Test fun countryFamiliesArePersonal() {
        for (e in listOf("a@hotmail.es", "a@outlook.com.mx", "a@yahoo.com.ar", "a@live.cl", "a@gmx.de")) assertTrue(e, Dominios.esPersonal(e))
    }

    @Test fun ownDomainsAreCommercial() {
        for (e in listOf("a@empresa.com", "a@lablpq.com", "a@gmail.com.evil.com", "a@mygmail.com", "a@nonosky.com")) assertFalse(e, Dominios.esPersonal(e))
    }

    @Test fun notAnAddressIsNeitherPersonalNorAnAddress() {
        for (e in listOf("", "sin-arroba", "@gmail.com", "a@", "a@localhost", null)) {
            assertFalse(e ?: "null", Dominios.esPersonal(e))
            assertFalse(Dominios.esCorreo(e))
        }
        assertEquals("gmail.com", Dominios.dominioDe(" Ana@Gmail.com. "))
    }

    @Test fun listHasTheSameSizeAsTheService() {
        // syncromail/api/app/dominios.py: DOMINIOS_PUBLICOS has 104 entries.
        assertEquals(104, Dominios.PUBLICOS.size)
    }
}
