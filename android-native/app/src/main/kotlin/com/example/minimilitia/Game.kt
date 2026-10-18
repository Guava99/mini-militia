package com.example.minimilitia

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

// Pure game logic: no Android types, so it is unit-testable and mirrors the Swift port 1:1.

const val KILL_LIMIT = 15
const val BOT_COUNT = 3
const val MAX_HP = 100f
const val MAX_FUEL = 100f
const val RESPAWN_S = 2.5f
const val CRATE_RESPAWN_S = 12f
const val GRAVITY = 900f
const val HALF_W = 9f
const val HALF_H = 22f

data class Weapon(
    val key: String,
    val name: String,
    val fireDelay: Float, // seconds between shots
    val damage: Float,
    val speed: Float,
    val spread: Float,
    val pellets: Int,
    val mag: Int,
    val reloadS: Float,
    val explosive: Float, // blast radius, 0 = none
    val length: Float,
    val color: Int,
)

object Weapons {
    val PISTOL = Weapon("pistol", "Pistol", 0.30f, 20f, 850f, 0.02f, 1, 12, 0.9f, 0f, 16f, 0xFF444444.toInt())
    val SMG = Weapon("smg", "SMG", 0.09f, 9f, 900f, 0.08f, 1, 30, 1.3f, 0f, 24f, 0xFF222222.toInt())
    val SHOTGUN = Weapon("shotgun", "Shotgun", 0.75f, 11f, 750f, 0.22f, 7, 6, 1.8f, 0f, 28f, 0xFF6B4423.toInt())
    val SNIPER = Weapon("sniper", "Sniper", 1.10f, 80f, 1700f, 0f, 1, 4, 2.2f, 0f, 40f, 0xFF2A3B2A.toInt())
    val ROCKET = Weapon("rocket", "Rocket", 1.20f, 70f, 520f, 0.01f, 1, 2, 2.5f, 100f, 34f, 0xFF7A2222.toInt())
    val PICKUPS = listOf(SMG, SHOTGUN, SNIPER, ROCKET)
}

class Rect(val x: Float, val y: Float, val w: Float, val h: Float, val kind: Kind = Kind.EARTH) {
    val right get() = x + w
    val bottom get() = y + h
}

class Intent {
    var left = false
    var right = false
    var thrust = false
    var aim = 0f
    var fire = false
    var reload = false
    var swap = false
    var grenade = false
}

class Fighter(val name: String, val isBot: Boolean, val color: Int) {
    var x = 0f
    var y = 0f
    var vx = 0f
    var vy = 0f
    var hp = MAX_HP
    var fuel = MAX_FUEL
    var weapon = Weapons.PISTOL
    var ammo = Weapons.PISTOL.mag
    var nextFire = 0f
    var reloadUntil = 0f // 0 = not reloading
    var kills = 0
    var deaths = 0
    var dead = false
    var aim = 0f
    var respawnAt = 0f
    var nextBotThink = 0f
    var onGround = false
    var blockedL = false
    var blockedR = false
    var thrusting = false
    var altWeapon: Weapon? = null
    var altAmmo = 0
    var grenades = 3
    var nextGrenade = 0f
    var lastShot = -1f
    val botIntent = Intent()
}

class Bullet(
    var x: Float, var y: Float, val vx: Float, val vy: Float,
    val owner: Fighter, val dmg: Float, val boom: Float, val born: Float,
) {
    val angle = atan2(vy, vx)
}

class Grenade(var x: Float, var y: Float, var vx: Float, var vy: Float, val owner: Fighter, val born: Float)

class Crate(val x: Float, val y: Float, val weapon: Weapon)

interface GameEvents {
    fun onShoot(heavy: Boolean) {}
    fun onExplode(x: Float, y: Float, radius: Float) {}
    fun onSpark(x: Float, y: Float, color: Int) {}
    fun onHit() {}
    fun onDie() {}
    fun onReload() {}
    fun onPickup() {}
}

class Game(
    private val rng: Random = Random.Default,
    var events: GameEvents = object : GameEvents {},
    val map: GameMap = Maps.all[0],
) {
    val fighters = ArrayList<Fighter>()
    val bullets = ArrayList<Bullet>()
    val crates = ArrayList<Crate>()
    val grenades = ArrayList<Grenade>()
    private val pendingCrates = ArrayList<Float>()
    val player: Fighter
    var time = 0f
        private set
    var over = false
        private set
    var winner: Fighter? = null
        private set

    init {
        player = spawnFighter("You", false, 0xFF3B82F6.toInt())
        val botColors = intArrayOf(0xFFEF4444.toInt(), 0xFF22C55E.toInt(), 0xFFEAB308.toInt(), 0xFFA855F7.toInt())
        for (i in 0 until BOT_COUNT) spawnFighter("Bot ${i + 1}", true, botColors[i % botColors.size])
        for (i in map.spawns.indices step 3) {
            val (sx, sy) = map.spawns[i]
            crates.add(Crate(sx + 40f, sy - 20f, Weapons.PICKUPS.random(rng)))
        }
    }

    private fun spawnFighter(name: String, bot: Boolean, color: Int): Fighter {
        val f = Fighter(name, bot, color)
        placeAtSpawn(f)
        equip(f, Weapons.PISTOL)
        fighters.add(f)
        return f
    }

    private fun placeAtSpawn(f: Fighter) {
        val (sx, sy) = map.spawns.random(rng)
        f.x = sx; f.y = sy; f.vx = 0f; f.vy = 0f
    }

    private fun equip(f: Fighter, w: Weapon) {
        f.weapon = w
        f.ammo = w.mag
        f.reloadUntil = 0f
    }

    // ---------- main step ----------

    fun update(dt: Float, playerIntent: Intent) {
        if (over) return
        time += dt
        for (f in fighters) {
            if (f.dead) {
                if (time >= f.respawnAt) respawn(f)
                continue
            }
            val intent = if (f.isBot) botIntent(f) else playerIntent
            applyIntent(f, intent, dt)
            collide(f, dt)
            pickCrates(f)
        }
        updateBullets(dt)
        updateGrenades(dt)
        val due = pendingCrates.filter { time >= it }
        if (due.isNotEmpty()) {
            pendingCrates.removeAll(due.toSet())
            for (d in due) {
                val (sx, sy) = map.spawns.random(rng)
                crates.add(Crate(sx + rng.nextInt(-40, 41), sy - 20f, Weapons.PICKUPS.random(rng)))
            }
        }
    }

    // ---------- fighters ----------

    private fun applyIntent(f: Fighter, i: Intent, dt: Float) {
        if (i.left) f.vx = -200f
        else if (i.right) f.vx = 200f
        else f.vx *= (if (f.onGround) 0.7f else 0.97f).pow(dt * 60f)

        f.thrusting = i.thrust && f.fuel > 0f
        if (f.thrusting) {
            f.vy = max(f.vy - 2200f * dt, -300f)
            f.fuel = max(0f, f.fuel - 38f * dt)
        } else {
            f.fuel = min(MAX_FUEL, f.fuel + (if (f.onGround) 55f else 8f) * dt)
        }
        f.vy = min(f.vy + GRAVITY * dt, 600f)
        f.vx = f.vx.coerceIn(-300f, 300f)
        f.aim = i.aim

        if (f.reloadUntil > 0f && time >= f.reloadUntil) {
            f.ammo = f.weapon.mag
            f.reloadUntil = 0f
        }
        if (i.swap) { swapWeapon(f); i.swap = false }
        if (i.grenade) { throwGrenade(f); i.grenade = false }
        if (i.reload && f.reloadUntil == 0f && f.ammo < f.weapon.mag) startReload(f)
        if (i.fire && f.reloadUntil == 0f && time >= f.nextFire) {
            if (f.ammo <= 0) startReload(f) else shoot(f)
        }
    }

    private fun startReload(f: Fighter) {
        f.reloadUntil = time + f.weapon.reloadS
        if (!f.isBot) events.onReload()
    }

    private fun overlaps(f: Fighter, p: Rect) =
        f.x + HALF_W > p.x && f.x - HALF_W < p.right && f.y + HALF_H > p.y && f.y - HALF_H < p.bottom

    private fun collide(f: Fighter, dt: Float) {
        f.blockedL = false; f.blockedR = false
        f.x += f.vx * dt
        for (p in map.platforms) {
            if (!overlaps(f, p)) continue
            if (f.vx > 0f) { f.x = p.x - HALF_W; f.blockedR = true }
            else if (f.vx < 0f) { f.x = p.right + HALF_W; f.blockedL = true }
        }
        f.y += f.vy * dt
        f.onGround = false
        for (p in map.platforms) {
            if (!overlaps(f, p)) continue
            if (f.vy > 0f) { f.y = p.y - HALF_H; f.onGround = true }
            else if (f.vy < 0f) { f.y = p.bottom + HALF_H }
            f.vy = 0f
        }
    }

    private fun pickCrates(f: Fighter) {
        val it = crates.iterator()
        while (it.hasNext()) {
            val c = it.next()
            if (abs(c.x - f.x) < HALF_W + 14f && abs(c.y - f.y) < HALF_H + 11f) {
                if (c.weapon === f.weapon) f.ammo = f.weapon.mag
                else {
                    if (f.altWeapon == null) { f.altWeapon = f.weapon; f.altAmmo = f.ammo }
                    equip(f, c.weapon)
                }
                f.hp = min(MAX_HP, f.hp + 25f)
                if (!f.isBot) events.onPickup()
                it.remove()
                pendingCrates.add(time + CRATE_RESPAWN_S)
            }
        }
    }

    private fun shoot(f: Fighter) {
        val w = f.weapon
        f.nextFire = time + w.fireDelay
        f.lastShot = time
        f.ammo--
        if (!f.isBot || hypot(f.x - player.x, f.y - player.y) < 900f) {
            events.onShoot(w.pellets > 1 || w.explosive > 0f || w.key == "sniper")
        }
        val muzzle = w.length + 2f
        val mx = f.x + cos(f.aim) * muzzle
        val my = f.y + 4f + sin(f.aim) * muzzle
        for (n in 0 until w.pellets) {
            val a = f.aim + (rng.nextFloat() * 2f - 1f) * w.spread
            bullets.add(Bullet(mx, my, cos(a) * w.speed, sin(a) * w.speed, f, w.damage, w.explosive, time))
        }
        if (w.key == "sniper" || w.explosive > 0f) f.vx -= cos(f.aim) * 120f
    }

    private fun swapWeapon(f: Fighter) {
        val a = f.altWeapon ?: return
        val w = f.weapon
        val am = f.ammo
        f.weapon = a; f.ammo = f.altAmmo
        f.altWeapon = w; f.altAmmo = am
        f.reloadUntil = 0f
        f.nextFire = time + 0.25f
    }

    private fun throwGrenade(f: Fighter) {
        if (f.grenades <= 0 || time < f.nextGrenade) return
        f.grenades--
        f.nextGrenade = time + 0.6f
        grenades.add(Grenade(f.x, f.y - 4f, cos(f.aim) * 480f + f.vx * 0.5f, sin(f.aim) * 480f - 60f, f, time))
        if (!f.isBot) events.onShoot(false)
    }

    private fun solidAt(x: Float, y: Float): Boolean {
        for (p in map.platforms) if (x + 4f > p.x && x - 4f < p.right && y + 4f > p.y && y - 4f < p.bottom) return true
        return false
    }

    private fun updateGrenades(dt: Float) {
        val it = grenades.iterator()
        while (it.hasNext()) {
            val g = it.next()
            if (time - g.born > 2f) {
                explode(g.x, g.y, g.owner, 80f, 90f)
                it.remove()
                continue
            }
            g.vy += GRAVITY * dt
            val nx = g.x + g.vx * dt
            if (solidAt(nx, g.y)) g.vx = -g.vx * 0.5f else g.x = nx
            val ny = g.y + g.vy * dt
            if (solidAt(g.x, ny)) {
                g.vy = -g.vy * 0.45f
                g.vx *= 0.8f
                if (abs(g.vy) < 30f) g.vy = 0f
            } else g.y = ny
        }
    }

    // ---------- bullets ----------

    private fun updateBullets(dt: Float) {
        val it = bullets.iterator()
        while (it.hasNext()) {
            val b = it.next()
            if (stepBullet(b, dt)) it.remove()
        }
    }

    /** Returns true when the bullet is spent. */
    private fun stepBullet(b: Bullet, dt: Float): Boolean {
        if (time - b.born > 1.6f) {
            if (b.boom > 0f) explode(b.x, b.y, b.owner, b.dmg, b.boom)
            return true
        }
        val dist = hypot(b.vx, b.vy) * dt
        val steps = max(1, ceil(dist / 8f).toInt())
        val sx = b.vx * dt / steps
        val sy = b.vy * dt / steps
        repeat(steps) {
            b.x += sx; b.y += sy
            for (p in map.platforms) {
                if (b.x > p.x && b.x < p.right && b.y > p.y && b.y < p.bottom) {
                    if (b.boom > 0f) explode(b.x, b.y, b.owner, b.dmg, b.boom)
                    else events.onSpark(b.x, b.y, 0xFFFFEE88.toInt())
                    return true
                }
            }
            for (f in fighters) {
                if (f.dead || f === b.owner) continue
                if (abs(b.x - f.x) < HALF_W && abs(b.y - f.y) < HALF_H) {
                    if (b.boom > 0f) explode(b.x, b.y, b.owner, b.dmg, b.boom)
                    else {
                        damage(f, b.dmg, b.owner)
                        events.onSpark(b.x, b.y, 0xFFFF3333.toInt())
                    }
                    return true
                }
            }
        }
        return false
    }

    private fun explode(x: Float, y: Float, owner: Fighter, dmg: Float, radius: Float) {
        events.onExplode(x, y, radius)
        for (f in fighters) {
            if (f.dead) continue
            val d = hypot(x - f.x, y - f.y)
            if (d > radius) continue
            damage(f, (dmg * (1f - d / radius * 0.7f)).toInt().toFloat(), owner)
            val a = atan2(f.y - y, f.x - x)
            f.vx = cos(a) * 400f
            f.vy = sin(a) * 400f - 150f
        }
    }

    private fun damage(target: Fighter, amount: Float, by: Fighter) {
        if (target.dead || over) return
        target.hp -= amount
        events.onHit()
        if (target.hp > 0f) return
        target.dead = true
        target.deaths++
        if (by !== target) by.kills++ else by.kills--
        events.onDie()
        events.onSpark(target.x, target.y, target.color)
        target.respawnAt = time + RESPAWN_S
        if (by.kills >= KILL_LIMIT) {
            over = true
            winner = by
        }
    }

    private fun respawn(f: Fighter) {
        placeAtSpawn(f)
        f.hp = MAX_HP
        f.fuel = MAX_FUEL
        f.dead = false
        f.altWeapon = null
        f.grenades = 3
        equip(f, Weapons.PISTOL)
    }

    // ---------- bots ----------

    private fun botIntent(f: Fighter): Intent {
        val i = f.botIntent
        if (time < f.nextBotThink) return i
        f.nextBotThink = time + 0.12f + rng.nextFloat() * 0.14f
        var target: Fighter? = null
        var best = Float.MAX_VALUE
        for (o in fighters) {
            if (o === f || o.dead) continue
            val d = hypot(f.x - o.x, f.y - o.y)
            if (d < best) { best = d; target = o }
        }
        i.left = false; i.right = false; i.thrust = false; i.fire = false; i.swap = false; i.grenade = false
        i.reload = f.ammo == 0
        if (target != null) {
            val dx = target.x - f.x
            val dy = target.y - f.y
            if (abs(dx) > 320f) { i.right = dx > 0; i.left = dx < 0 }
            else if (abs(dx) < 140f) { i.right = dx < 0; i.left = dx > 0 }
            else if (rng.nextFloat() < 0.3f) { i.right = rng.nextBoolean(); i.left = !i.right }
            i.thrust = (dy < -40f && f.fuel > 5f) || f.blockedL || f.blockedR
            i.aim = atan2(dy - 4f, dx) + (rng.nextFloat() * 2f - 1f) * 0.25f
            i.fire = best < 750f && rng.nextFloat() < 0.5f
            i.grenade = best in 250f..500f && rng.nextFloat() < 0.06f
        } else {
            i.aim = f.aim
        }
        return i
    }
}
