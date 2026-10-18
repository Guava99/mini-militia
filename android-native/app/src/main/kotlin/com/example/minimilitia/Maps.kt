package com.example.minimilitia

import kotlin.random.Random

enum class Kind { EARTH, STONE, METAL, SNOW, SAND }

class Theme(
    val skyTop: Int,
    val skyBottom: Int,
    val far: Int,
    val near: Int,
    val sun: Int,
    val decoKinds: List<String>,
)

class Deco(val kind: String, val x: Float, val y: Float, val scale: Float)

class GameMap(
    val name: String,
    val w: Float,
    val h: Float,
    val platforms: List<Rect>,
    val theme: Theme,
    val seed: Long,
    val spawns: List<Pair<Float, Float>>,
    val decos: List<Deco>,
)

/** Original map layouts. Everything is hand-designed for this game. */
object Maps {
    private val JUNGLE = Theme(0xFF5DB7E8.toInt(), 0xFFD7F0C8.toInt(), 0xFF8DB88B.toInt(), 0xFF5E9460.toInt(), 0xFFFFF2A0.toInt(), listOf("tree", "bush", "rock", "tree"))
    private val SNOW = Theme(0xFFA8C8E8.toInt(), 0xFFEAF3FA.toInt(), 0xFFC4D6E6.toInt(), 0xFF9FB8D0.toInt(), 0xFFFFFFFF.toInt(), listOf("pine", "rock", "pine"))
    private val DESERT = Theme(0xFFF3A65A.toInt(), 0xFFFFE2A8.toInt(), 0xFFD9A066.toInt(), 0xFFC28350.toInt(), 0xFFFFF5C0.toInt(), listOf("cactus", "rock", "cactus"))

    private fun r(x: Float, y: Float, w: Float, h: Float, k: Kind) = Rect(x, y, w, h, k)

    private fun build(name: String, w: Float, h: Float, theme: Theme, ground: Kind, seed: Long, inner: List<Rect>): GameMap {
        val g = Rect(0f, h - 50f, w, 50f, ground)
        val frame = listOf(g, Rect(-40f, 0f, 40f, h, Kind.STONE), Rect(w, 0f, 40f, h, Kind.STONE), Rect(0f, -40f, w, 40f, Kind.STONE))
        val platforms = frame + inner
        val rng = Random(seed)

        // spawn points on top of platforms, dropping any that would start inside geometry
        val raw = ArrayList<Pair<Float, Float>>()
        for (x in floatArrayOf(w * 0.1f, w * 0.5f, w * 0.9f)) raw.add(x to g.y - HALF_H - 1f)
        for (p in inner) {
            if (p.w >= 300f) { raw.add(p.x + p.w * 0.25f to p.y - HALF_H - 1f); raw.add(p.x + p.w * 0.75f to p.y - HALF_H - 1f) }
            else raw.add(p.x + p.w / 2f to p.y - HALF_H - 1f)
        }
        val spawns = raw.filter { (sx, sy) ->
            platforms.none { sx + HALF_W + 2f > it.x && sx - HALF_W - 2f < it.right && sy + HALF_H + 0.5f > it.y && sy - HALF_H - 2f < it.bottom }
        }

        val decos = ArrayList<Deco>()
        var gx = 200f
        while (gx < w - 200f) {
            decos.add(Deco(theme.decoKinds.random(rng), gx, g.y, 0.9f + rng.nextFloat() * 0.5f))
            gx += 260f + rng.nextFloat() * 300f
        }
        for (p in inner) if (p.w >= 240f) {
            decos.add(Deco(theme.decoKinds.random(rng), p.x + 30f + rng.nextFloat() * (p.w - 60f), p.y, 0.6f + rng.nextFloat() * 0.35f))
        }
        return GameMap(name, w, h, platforms, theme, seed, spawns, decos)
    }

    val all: List<GameMap> by lazy {
        listOf(
            build("Jungle Ruins", 2800f, 1300f, JUNGLE, Kind.EARTH, 11, listOf(
                r(200f, 1060f, 360f, 30f, Kind.EARTH), r(900f, 1090f, 300f, 30f, Kind.EARTH), r(1500f, 1050f, 360f, 30f, Kind.EARTH), r(2150f, 1080f, 400f, 30f, Kind.EARTH),
                r(700f, 1150f, 90f, 100f, Kind.STONE), r(1300f, 1130f, 120f, 120f, Kind.STONE), r(2000f, 1170f, 90f, 80f, Kind.STONE),
                r(100f, 860f, 300f, 30f, Kind.EARTH), r(550f, 820f, 320f, 30f, Kind.EARTH), r(1050f, 880f, 300f, 30f, Kind.EARTH), r(1650f, 840f, 320f, 30f, Kind.EARTH), r(2250f, 860f, 350f, 30f, Kind.EARTH),
                r(350f, 630f, 350f, 30f, Kind.EARTH), r(900f, 600f, 300f, 30f, Kind.STONE), r(1400f, 660f, 360f, 30f, Kind.EARTH), r(1950f, 620f, 320f, 30f, Kind.EARTH), r(2450f, 650f, 250f, 30f, Kind.EARTH),
                r(200f, 410f, 300f, 30f, Kind.EARTH), r(700f, 380f, 380f, 30f, Kind.STONE), r(1300f, 420f, 300f, 30f, Kind.EARTH), r(1800f, 390f, 360f, 30f, Kind.EARTH), r(2300f, 430f, 300f, 30f, Kind.EARTH),
                r(500f, 200f, 300f, 30f, Kind.STONE), r(1150f, 180f, 500f, 30f, Kind.STONE), r(2000f, 210f, 300f, 30f, Kind.STONE),
            )),
            build("Snow Outpost", 2400f, 1200f, SNOW, Kind.SNOW, 22, listOf(
                r(100f, 980f, 300f, 28f, Kind.SNOW), r(550f, 900f, 280f, 28f, Kind.SNOW), r(1000f, 980f, 320f, 28f, Kind.SNOW), r(1450f, 880f, 300f, 28f, Kind.SNOW), r(1900f, 960f, 350f, 28f, Kind.SNOW),
                r(800f, 1060f, 100f, 90f, Kind.SNOW), r(1650f, 1040f, 100f, 110f, Kind.SNOW),
                r(250f, 740f, 340f, 28f, Kind.SNOW), r(750f, 660f, 300f, 28f, Kind.SNOW), r(1250f, 720f, 320f, 28f, Kind.SNOW), r(1750f, 640f, 300f, 28f, Kind.SNOW), r(2100f, 760f, 250f, 28f, Kind.SNOW),
                r(100f, 500f, 280f, 28f, Kind.SNOW), r(520f, 440f, 340f, 28f, Kind.SNOW), r(1050f, 500f, 300f, 28f, Kind.SNOW), r(1500f, 420f, 360f, 28f, Kind.SNOW), r(2000f, 480f, 280f, 28f, Kind.SNOW),
                r(700f, 260f, 420f, 28f, Kind.METAL), r(1400f, 240f, 420f, 28f, Kind.METAL),
            )),
            build("Desert Base", 3000f, 1200f, DESERT, Kind.SAND, 33, listOf(
                r(150f, 1000f, 300f, 26f, Kind.METAL), r(600f, 1020f, 260f, 26f, Kind.METAL), r(1100f, 980f, 340f, 26f, Kind.METAL), r(1650f, 1010f, 300f, 26f, Kind.METAL), r(2150f, 990f, 320f, 26f, Kind.METAL), r(2600f, 1020f, 260f, 26f, Kind.METAL),
                r(900f, 1070f, 120f, 80f, Kind.SAND), r(1500f, 1050f, 140f, 100f, Kind.SAND), r(2400f, 1060f, 120f, 90f, Kind.SAND),
                r(300f, 820f, 360f, 26f, Kind.METAL), r(850f, 780f, 300f, 26f, Kind.METAL), r(1350f, 840f, 340f, 26f, Kind.METAL), r(1900f, 790f, 300f, 26f, Kind.METAL), r(2400f, 830f, 360f, 26f, Kind.METAL),
                r(100f, 600f, 300f, 26f, Kind.SAND), r(600f, 560f, 360f, 26f, Kind.METAL), r(1200f, 610f, 300f, 26f, Kind.METAL), r(1750f, 570f, 360f, 26f, Kind.METAL), r(2350f, 600f, 300f, 26f, Kind.METAL),
                r(400f, 360f, 320f, 26f, Kind.METAL), r(1000f, 320f, 380f, 26f, Kind.METAL), r(1650f, 340f, 320f, 26f, Kind.METAL), r(2250f, 370f, 360f, 26f, Kind.METAL),
            )),
        )
    }
}
