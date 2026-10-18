package com.example.minimilitia

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GameTest {
    private val idle = Intent()

    @Test fun fightersSettleOnPlatformsAndStayInWorld() {
        val g = Game(Random(1))
        repeat(60 * 20) { g.update(1f / 60f, idle) }
        for (f in g.fighters) {
            assertTrue("${f.name} x=${f.x}", f.x in 0f..g.map.w)
            assertTrue("${f.name} y=${f.y}", f.y in 0f..g.map.h)
        }
    }

    @Test fun everyMapHasSafeSpawnsAndIsPlayable() {
        for (m in Maps.all) {
            assertTrue("${m.name} needs spawns", m.spawns.size >= 8)
            val g = Game(Random(5), map = m)
            repeat(60 * 10) { g.update(1f / 60f, idle) }
            for (f in g.fighters) {
                assertTrue("${m.name} ${f.name} x=${f.x}", f.x in 0f..m.w)
                assertTrue("${m.name} ${f.name} y=${f.y}", f.y in 0f..m.h)
            }
        }
    }

    @Test fun jetpackLiftsAndDrainsFuel() {
        val g = Game(Random(2))
        repeat(120) { g.update(1f / 60f, idle) }
        val y0 = g.player.y
        val up = Intent().apply { thrust = true }
        repeat(30) { g.update(1f / 60f, up) }
        assertTrue(g.player.y < y0 - 20f || g.player.fuel < MAX_FUEL)
        assertTrue(g.player.fuel < MAX_FUEL)
    }

    @Test fun pistolShotConsumesAmmo() {
        val g = Game(Random(3))
        val fire = Intent().apply { fire = true }
        g.update(1f / 60f, fire)
        assertEquals(Weapons.PISTOL.mag - 1, g.player.ammo)
        assertFalse(g.bullets.isEmpty())
    }

    @Test fun botsPlayToAnEnd() {
        val g = Game(Random(4))
        var steps = 0
        while (!g.over && steps < 60 * 60 * 30) { g.update(1f / 60f, idle); steps++ }
        assertTrue("match should finish within 30 simulated minutes", g.over)
        assertTrue(g.winner!!.kills >= KILL_LIMIT)
    }
}
