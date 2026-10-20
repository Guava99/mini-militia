package com.example.minimilitia

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.PI

private const val VH = 720f
private const val STICK_R = 70f

private class Stick(val id: Int, val ox: Float, val oy: Float) {
    var x = ox
    var y = oy
    fun axisX() = axis().first
    fun axisY() = axis().second
    fun axis(): Pair<Float, Float> {
        val dx = x - ox; val dy = y - oy
        val m = min(1f, hypot(dx, dy) / STICK_R)
        val a = atan2(dy, dx)
        return cos(a) * m to sin(a) * m
    }
}

private class Particle(var x: Float, var y: Float, val vx: Float, val vy: Float, val color: Int, var life: Float)
private class Ring(val x: Float, val y: Float, val maxR: Float, var t: Float = 0f)

class GameView(context: Context) : SurfaceView(context), SurfaceHolder.Callback, Runnable, GameEvents {
    private val sound = Sound(context)
    private var mapIndex = (Math.random() * Maps.all.size).toInt()
    private var game = Game(events = this, map = Maps.all[mapIndex])
    private var thread: Thread? = null
    @Volatile private var running = false

    // touch state, shared between UI and game threads
    private val lock = Any()
    private var left: Stick? = null
    private var right: Stick? = null
    private var reloadTap = false
    private var swapTap = false
    private var grenadeTap = false
    private var vw = 1280f
    private var restartTap = false

    private val particles = ArrayList<Particle>()
    private val rings = ArrayList<Ring>()
    private var camX = 0f
    private var camY = 0f
    private var shake = 0f
    private var lastAim = 0f

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = android.graphics.Typeface.MONOSPACE }
    private val rectF = RectF()

    init { holder.addCallback(this) }

    fun releaseSound() = sound.release()

    // ---------- GameEvents: forward to sound, spawn particles ----------

    override fun onShoot(heavy: Boolean) = sound.onShoot(heavy)
    override fun onHit() = sound.onHit()
    override fun onDie() = sound.onDie()
    override fun onReload() = sound.onReload()
    override fun onPickup() = sound.onPickup()
    override fun onExplode(x: Float, y: Float, radius: Float) {
        sound.onExplode(x, y, radius)
        synchronized(rings) { rings.add(Ring(x, y, radius)) }
        shake = 0.15f
    }
    override fun onSpark(x: Float, y: Float, color: Int) {
        synchronized(particles) {
            repeat(4) {
                val a = (Math.random() * 2 * PI).toFloat()
                val s = 40f + (Math.random() * 60f).toFloat()
                particles.add(Particle(x, y, cos(a) * s, sin(a) * s, color, 0.25f))
            }
        }
    }

    // ---------- lifecycle ----------

    override fun surfaceCreated(holder: SurfaceHolder) {
        running = true
        thread = Thread(this, "game-loop").also { it.start() }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        running = false
        thread?.join()
        thread = null
    }

    override fun run() {
        var last = System.nanoTime()
        while (running) {
            val now = System.nanoTime()
            val dt = min(0.05f, (now - last) / 1e9f)
            last = now
            step(dt)
            val c = holder.lockCanvas() ?: continue
            try { render(c, dt) } finally { holder.unlockCanvasAndPost(c) }
        }
    }

    // ---------- input ----------

    private var scale = 1f
    private var offX = 0f
    private var offY = 0f

    override fun onTouchEvent(e: MotionEvent): Boolean {
        synchronized(lock) {
            val idx = e.actionIndex
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                    val id = e.getPointerId(idx)
                    val x = (e.getX(idx) - offX) / scale
                    val y = (e.getY(idx) - offY) / scale
                    restartTap = true
                    if (hypot(x - (vw - 70f), y - 40f) < 45f) reloadTap = true
                    else if (hypot(x - (vw - 70f), y - 110f) < 45f) swapTap = true
                    else if (hypot(x - (vw - 70f), y - 180f) < 45f) grenadeTap = true
                    else if (x < vw / 2 && left == null) left = Stick(id, x, y)
                    else if (x >= vw / 2 && right == null) right = Stick(id, x, y)
                }
                MotionEvent.ACTION_MOVE -> for (i in 0 until e.pointerCount) {
                    val id = e.getPointerId(i)
                    val x = (e.getX(i) - offX) / scale
                    val y = (e.getY(i) - offY) / scale
                    left?.takeIf { it.id == id }?.let { it.x = x; it.y = y }
                    right?.takeIf { it.id == id }?.let { it.x = x; it.y = y }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_CANCEL -> {
                    val id = e.getPointerId(idx)
                    if (left?.id == id) left = null
                    if (right?.id == id) right = null
                    if (e.actionMasked == MotionEvent.ACTION_CANCEL) { left = null; right = null }
                }
            }
        }
        return true
    }

    // ---------- simulation ----------

    private val intent = Intent()

    private fun step(dt: Float) {
        val restart: Boolean
        synchronized(lock) {
            val l = left?.axis() ?: (0f to 0f)
            val r = right?.axis() ?: (0f to 0f)
            val aimMag = hypot(r.first, r.second)
            if (aimMag > 0.1f) lastAim = atan2(r.second, r.first)
            intent.left = l.first < -0.25f
            intent.right = l.first > 0.25f
            intent.thrust = l.second < -0.5f
            intent.aim = lastAim
            intent.fire = aimMag > 0.3f
            intent.reload = reloadTap
            intent.swap = swapTap
            intent.grenade = grenadeTap
            reloadTap = false; swapTap = false; grenadeTap = false
            restart = restartTap && game.over
            restartTap = false
        }
        if (restart) {
            mapIndex = (mapIndex + 1) % Maps.all.size
            game = Game(events = this, map = Maps.all[mapIndex])
            return
        }
        game.update(dt, intent)

        synchronized(particles) {
            val it = particles.iterator()
            while (it.hasNext()) {
                val p = it.next()
                p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt
                if (p.life <= 0f) it.remove()
            }
        }
        synchronized(rings) {
            val it = rings.iterator()
            while (it.hasNext()) { val r = it.next(); r.t += dt / 0.3f; if (r.t >= 1f) it.remove() }
        }
        shake = max(0f, shake - dt)

        val p = game.player
        val k = 1f - 0.88f.pow(dt * 60f)
        camX += (p.x - vw / 2 - camX) * k
        camY += (p.y - VH / 2 - camY) * k
        camX = camX.coerceIn(0f, game.map.w - vw)
        camY = camY.coerceIn(-40f, game.map.h - VH)
    }

    // ---------- rendering ----------

    private fun render(c: Canvas, dt: Float) {
        c.drawColor(Color.BLACK)
        vw = max(1280f, VH * width / height) // fill wide phone screens
        scale = min(width / vw, height / VH)
        offX = (width - vw * scale) / 2f
        offY = (height - VH * scale) / 2f
        c.save()
        c.translate(offX, offY)
        c.scale(scale, scale)
        c.clipRect(0f, 0f, vw, VH)

        drawBackground(c)

        c.save()
        val sx = if (shake > 0f) ((Math.random() - 0.5) * 8).toFloat() else 0f
        val sy = if (shake > 0f) ((Math.random() - 0.5) * 8).toFloat() else 0f
        c.translate(-camX + sx, -camY + sy)
        drawWorld(c)
        c.restore()

        drawHud(c)
        drawTouch(c)
        c.restore()
    }

    private var bgMap: GameMap? = null
    private var farPts = FloatArray(0)
    private var nearPts = FloatArray(0)

    private fun genPeaks(seed: Long, n: Int, base: Float, spread: Float): FloatArray {
        val rng = java.util.Random(seed)
        val out = FloatArray(n)
        var h = base
        for (i in 0 until n) {
            h = (h + (rng.nextFloat() - 0.5f) * spread).coerceIn(base * 0.4f, base * 1.6f)
            out[i] = h
        }
        return out
    }

    private fun drawPeaks(c: Canvas, pts: FloatArray, parallax: Float, baseY: Float, color: Int) {
        val step = 120f
        val x0 = -camX * parallax
        path.reset()
        path.moveTo(x0, VH)
        for (i in pts.indices) path.lineTo(x0 + i * step, baseY - pts[i])
        path.lineTo(x0 + (pts.size - 1) * step, VH)
        path.close()
        fill.color = color
        c.drawPath(path, fill)
    }

    private fun drawBackground(c: Canvas) {
        val m = game.map
        val t = m.theme
        if (bgMap !== m) {
            bgMap = m
            val steps = ((m.w * 0.4f + 1800f) / 120f).toInt() + 2
            farPts = genPeaks(m.seed, steps, 160f, 90f)
            nearPts = genPeaks(m.seed + 7, steps, 100f, 70f)
        }
        fill.color = Color.WHITE // reset leaked alpha from the previous frame
        fill.shader = LinearGradient(0f, 0f, 0f, VH, t.skyTop, t.skyBottom, Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, vw, VH, fill)
        fill.shader = null

        // sun with glow
        val sx = vw * 0.78f
        fill.color = t.sun; fill.alpha = 60; c.drawCircle(sx, 130f, 90f, fill)
        fill.alpha = 110; c.drawCircle(sx, 130f, 62f, fill)
        fill.alpha = 255; c.drawCircle(sx, 130f, 40f, fill)

        // drifting clouds
        fill.color = 0xCCFFFFFF.toInt()
        for (i in 0 until 7) {
            val span = vw + 400f
            var cx = (i * 330f + game.time * (6f + i % 3 * 3f) - camX * 0.15f) % span
            if (cx < 0f) cx += span
            cx -= 200f
            val cy = 80f + (i % 4) * 55f
            rectF.set(cx - 80f, cy - 22f, cx + 80f, cy + 22f); c.drawOval(rectF, fill)
            rectF.set(cx - 20f, cy - 38f, cx + 70f, cy + 6f); c.drawOval(rectF, fill)
        }

        drawPeaks(c, farPts, 0.2f, 520f, t.far)
        drawPeaks(c, nearPts, 0.4f, 600f, t.near)
    }

    private fun drawWorld(c: Canvas) {
        val vx0 = camX - 60f
        val vx1 = camX + vw + 60f
        for (d in game.map.decos) if (d.x in vx0..vx1) drawDeco(c, d)
        for (p in game.map.platforms) if (p.right > vx0 && p.x < vx1) drawPlatform(c, p)
        for (cr in game.crates) {
            val bob = sin(game.time * 4.5f + cr.x) * 3f
            fill.color = 0xFFC89B3C.toInt()
            c.drawRect(cr.x - 14f, cr.y - 11f + bob, cr.x + 14f, cr.y + 11f + bob, fill)
            stroke.color = 0xFF5A4210.toInt(); stroke.strokeWidth = 2f
            c.drawRect(cr.x - 14f, cr.y - 11f + bob, cr.x + 14f, cr.y + 11f + bob, stroke)
            c.drawLine(cr.x - 14f, cr.y - 11f + bob, cr.x + 14f, cr.y + 11f + bob, stroke)
            c.drawLine(cr.x + 14f, cr.y - 11f + bob, cr.x - 14f, cr.y + 11f + bob, stroke)
        }
        for (f in game.fighters) if (!f.dead && f !== game.player) drawFighter(c, f)
        if (!game.player.dead) drawFighter(c, game.player)

        for (g in game.grenades) {
            fill.color = 0xFF2E4A2E.toInt(); c.drawCircle(g.x, g.y, 6f, fill)
            if (((game.time - g.born) * 6f).toInt() % 2 == 0) { fill.color = 0xFFFF3333.toInt(); c.drawCircle(g.x, g.y - 3f, 2f, fill) }
        }
        for (b in game.bullets) {
            c.save()
            c.translate(b.x, b.y)
            c.rotate(Math.toDegrees(b.angle.toDouble()).toFloat())
            if (b.boom > 0f) {
                fill.color = 0xFFFF6633.toInt(); c.drawRect(-14f, -3f, 0f, 3f, fill)
                fill.color = 0xFFCCCCCC.toInt(); c.drawRect(0f, -2f, 4f, 2f, fill)
            } else {
                fill.color = 0xFFFFFF99.toInt(); c.drawRect(-5f, -1.5f, 5f, 1.5f, fill)
            }
            c.restore()
        }
        synchronized(particles) {
            for (p in particles) {
                fill.color = p.color; fill.alpha = (255 * (p.life / 0.25f)).toInt().coerceIn(0, 255)
                c.drawRect(p.x - 1.5f, p.y - 1.5f, p.x + 1.5f, p.y + 1.5f, fill)
            }
            fill.alpha = 255
        }
        synchronized(rings) {
            for (r in rings) {
                fill.color = 0xFFFFAA33.toInt(); fill.alpha = ((1f - r.t) * 230).toInt().coerceIn(0, 255)
                c.drawCircle(r.x, r.y, 10f + (r.maxR - 10f) * r.t, fill)
                fill.color = 0xFFFFE066.toInt(); fill.alpha = ((1f - r.t) * 255).toInt().coerceIn(0, 255)
                c.drawCircle(r.x, r.y, (10f + (r.maxR - 10f) * r.t) * 0.55f, fill)
            }
            fill.alpha = 255
        }
        for (f in game.fighters) if (!f.dead) drawBars(c, f)
    }

    private val path = android.graphics.Path()

    private fun drawPlatform(c: Canvas, p: Rect) {
        val base: Int; val cap: Int; val edge: Int
        when (p.kind) {
            Kind.EARTH -> { base = 0xFF7A5230.toInt(); cap = 0xFF4FA03A.toInt(); edge = 0xFF3B2814.toInt() }
            Kind.STONE -> { base = 0xFF8A8F98.toInt(); cap = 0xFFA8ADB5.toInt(); edge = 0xFF4B5058.toInt() }
            Kind.METAL -> { base = 0xFF5A6572.toInt(); cap = 0xFF8C99A6.toInt(); edge = 0xFF2B323A.toInt() }
            Kind.SNOW -> { base = 0xFF7FA6CC.toInt(); cap = 0xFFFFFFFF.toInt(); edge = 0xFF456A8F.toInt() }
            Kind.SAND -> { base = 0xFFD9B26A.toInt(); cap = 0xFFEBCB8B.toInt(); edge = 0xFF8F6E33.toInt() }
        }
        fill.color = base
        c.drawRect(p.x, p.y, p.right, p.bottom, fill)
        val capH = minOf(10f, p.h / 2f)
        val seed = (p.x.toInt() * 31 + p.y.toInt()) and 0xFFFF
        when (p.kind) {
            Kind.EARTH -> {
                fill.color = shade(base, 0.8f)
                var k = 0
                while (k < p.w / 22f && p.h > 20f) {
                    val sx = p.x + ((k * 37 + seed) % p.w.toInt().coerceAtLeast(1))
                    val sy = p.y + capH + 4f + ((k * 53 + seed) % (p.h - capH - 6f).toInt().coerceAtLeast(1))
                    c.drawCircle(sx, sy, 3f, fill); k++
                }
            }
            Kind.STONE -> {
                stroke.color = edge; stroke.strokeWidth = 1.5f
                var y = p.y + capH + 12f
                var row = 0
                while (y < p.bottom) {
                    c.drawLine(p.x, y, p.right, y, stroke)
                    var x = p.x + (if (row % 2 == 0) 0f else 20f)
                    while (x < p.right) { c.drawLine(x, y - 12f, x, y, stroke); x += 40f }
                    y += 12f; row++
                }
            }
            Kind.METAL -> {
                stroke.color = shade(base, 0.75f); stroke.strokeWidth = 2f
                var x = p.x
                while (x < p.right - 20f) { c.drawLine(x, p.bottom, x + 20f, p.y + capH, stroke); c.drawLine(x + 20f, p.bottom, x, p.y + capH, stroke); x += 20f }
                fill.color = 0xFF2B323A.toInt()
                x = p.x + 8f
                while (x < p.right) { c.drawCircle(x, p.y + capH + 4f, 1.8f, fill); x += 30f }
            }
            Kind.SNOW -> {
                fill.color = 0xFFCDE6FA.toInt()
                var x = p.x + 10f
                while (x < p.right - 10f) {
                    path.reset(); path.moveTo(x - 6f, p.bottom); path.lineTo(x + 6f, p.bottom); path.lineTo(x, p.bottom + 10f + ((x.toInt() / 7) % 3) * 5f); path.close()
                    c.drawPath(path, fill); x += 34f
                }
            }
            Kind.SAND -> {
                stroke.color = shade(base, 0.88f); stroke.strokeWidth = 2f
                var y = p.y + capH + 8f
                while (y < p.bottom) { c.drawLine(p.x, y, p.right, y, stroke); y += 14f }
            }
        }
        fill.color = cap
        c.drawRect(p.x, p.y, p.right, p.y + capH, fill)
        if (p.kind == Kind.EARTH) { // grass blades
            fill.color = shade(cap, 0.85f)
            var x = p.x + 4f
            while (x < p.right - 4f) {
                path.reset(); path.moveTo(x - 3f, p.y); path.lineTo(x, p.y - 7f - ((x.toInt() / 5) % 3) * 2f); path.lineTo(x + 3f, p.y); path.close()
                c.drawPath(path, fill); x += 18f
            }
        }
        stroke.color = edge; stroke.strokeWidth = 3f
        c.drawRect(p.x, p.y, p.right, p.bottom, stroke)
    }

    private fun drawDeco(c: Canvas, d: Deco) {
        c.save()
        c.translate(d.x, d.y)
        c.scale(d.scale, d.scale)
        when (d.kind) {
            "tree" -> {
                fill.color = 0xFF6B4423.toInt(); c.drawRect(-6f, -55f, 6f, 0f, fill)
                fill.color = 0xFF2E7D32.toInt()
                c.drawCircle(0f, -78f, 30f, fill); c.drawCircle(-22f, -58f, 22f, fill); c.drawCircle(22f, -58f, 22f, fill)
                fill.color = 0xFF43A047.toInt(); c.drawCircle(-8f, -86f, 15f, fill)
            }
            "bush" -> {
                fill.color = 0xFF3E8E41.toInt(); c.drawCircle(-14f, -10f, 13f, fill); c.drawCircle(8f, -13f, 16f, fill); c.drawCircle(24f, -8f, 11f, fill)
            }
            "rock" -> {
                fill.color = 0xFF8D939B.toInt(); rectF.set(-20f, -20f, 20f, 0f); c.drawOval(rectF, fill)
                fill.color = 0xFFB4BAC2.toInt(); rectF.set(-12f, -18f, 4f, -9f); c.drawOval(rectF, fill)
            }
            "pine" -> {
                fill.color = 0xFF5A3A20.toInt(); c.drawRect(-4f, -18f, 4f, 0f, fill)
                for ((i, hw) in floatArrayOf(34f, 28f, 20f).withIndex()) {
                    val top = -30f - i * 28f - 30f
                    val bot = -18f - i * 28f
                    path.reset(); path.moveTo(-hw, bot); path.lineTo(hw, bot); path.lineTo(0f, top); path.close()
                    fill.color = 0xFF2F6B4F.toInt(); c.drawPath(path, fill)
                    path.reset(); path.moveTo(-hw * 0.5f, top + (bot - top) * 0.45f); path.lineTo(hw * 0.5f, top + (bot - top) * 0.45f); path.lineTo(0f, top); path.close()
                    fill.color = 0xFFFFFFFF.toInt(); c.drawPath(path, fill)
                }
            }
            "cactus" -> {
                fill.color = 0xFF3F8F3F.toInt()
                rectF.set(-7f, -64f, 7f, 0f); c.drawRoundRect(rectF, 7f, 7f, fill)
                rectF.set(-24f, -42f, -6f, -31f); c.drawRoundRect(rectF, 5f, 5f, fill)
                rectF.set(-24f, -56f, -15f, -34f); c.drawRoundRect(rectF, 5f, 5f, fill)
                rectF.set(6f, -50f, 24f, -39f); c.drawRoundRect(rectF, 5f, 5f, fill)
                rectF.set(15f, -62f, 24f, -42f); c.drawRoundRect(rectF, 5f, 5f, fill)
            }
        }
        c.restore()
    }

    private fun shade(color: Int, f: Float): Int =
        Color.rgb((Color.red(color) * f).toInt().coerceIn(0, 255), (Color.green(color) * f).toInt().coerceIn(0, 255), (Color.blue(color) * f).toInt().coerceIn(0, 255))

    private fun drawFighter(c: Canvas, f: Fighter) {
        val facingLeft = cos(f.aim) < 0f
        val moving = f.onGround && kotlin.math.abs(f.vx) > 20f
        val swing = if (moving) sin(game.time * 14f) * 4f else 0f
        val dark = shade(f.color, 0.7f)

        c.save()
        c.translate(f.x, f.y)
        if (facingLeft) c.scale(-1f, 1f)

        // jetpack on the back, with flame while thrusting
        if (f.thrusting) {
            val flick = 10f + (Math.random() * 10f).toFloat()
            path.reset(); path.moveTo(-13f, 12f); path.lineTo(-7f, 12f); path.lineTo(-10f, 12f + flick + 8f); path.close()
            fill.color = 0xFFFF7A1A.toInt(); c.drawPath(path, fill)
            path.reset(); path.moveTo(-12f, 12f); path.lineTo(-8f, 12f); path.lineTo(-10f, 12f + flick); path.close()
            fill.color = 0xFFFFE066.toInt(); c.drawPath(path, fill)
        }
        fill.color = 0xFF555B66.toInt()
        rectF.set(-14f, -8f, -7f, 12f); c.drawRoundRect(rectF, 3f, 3f, fill)
        fill.color = 0xFF2F333A.toInt(); c.drawRect(-14f, 9f, -7f, 12f, fill)

        // legs (animated)
        fill.color = dark
        c.drawRect(-6f + swing, 13f, -1f + swing, 23f, fill)
        c.drawRect(1f - swing, 13f, 6f - swing, 23f, fill)
        fill.color = 0xFF222222.toInt()
        c.drawRect(-7f + swing, 20f, -1f + swing, 23f, fill)
        c.drawRect(1f - swing, 20f, 7f - swing, 23f, fill)

        // torso + belt
        fill.color = f.color
        rectF.set(-8f, -9f, 8f, 15f); c.drawRoundRect(rectF, 4f, 4f, fill)
        fill.color = 0xFF2F333A.toInt(); c.drawRect(-8f, 9f, 8f, 12f, fill)

        // head: skin, helmet, visor
        fill.color = 0xFFF0C9A0.toInt(); c.drawCircle(1f, -15f, 7f, fill)
        fill.color = dark
        rectF.set(-8f, -24f, 10f, -10f); c.drawArc(rectF, 180f, 180f, true, fill)
        c.drawRect(-8f, -17f, -3f, -11f, fill)
        fill.color = 0xFF1F2937.toInt(); c.drawRect(1f, -18f, 9f, -14f, fill)
        c.restore()

        // arm: shoulder to the grip
        val sx = f.x
        val sy = f.y - 3f
        val gx = f.x + cos(f.aim) * 10f
        val gy = f.y + 4f + sin(f.aim) * 10f
        stroke.color = dark; stroke.strokeWidth = 5f; stroke.strokeCap = Paint.Cap.ROUND
        c.drawLine(sx, sy, gx, gy, stroke)
        stroke.strokeCap = Paint.Cap.BUTT

        c.save()
        c.translate(f.x, f.y + 4f)
        c.rotate(Math.toDegrees(f.aim.toDouble()).toFloat())
        if (facingLeft) c.scale(1f, -1f)
        drawGun(c, f.weapon)
        if (game.time - f.lastShot < 0.06f) {
            val l = f.weapon.length
            fill.color = 0xFFFFE066.toInt(); c.drawCircle(l + 4f, 0f, 7f, fill)
            fill.color = 0xFFFFFFFF.toInt(); c.drawCircle(l + 4f, 0f, 3f, fill)
        }
        c.restore()
    }

    private fun drawGun(c: Canvas, w: Weapon) {
        val l = w.length
        fill.color = w.color
        when (w.key) {
            "pistol" -> {
                c.drawRect(0f, -3f, l, 0f, fill)
                fill.color = 0xFF222222.toInt(); c.drawRect(2f, 0f, 7f, 6f, fill)
            }
            "smg" -> {
                c.drawRect(0f, -3f, l, 1.5f, fill)
                fill.color = 0xFF111111.toInt()
                c.drawRect(6f, 1f, 10f, 9f, fill) // magazine
                c.drawRect(l - 6f, -4f, l, -3f, fill)
            }
            "shotgun" -> {
                fill.color = 0xFF6B4423.toInt(); c.drawRect(-6f, -3f, 8f, 2f, fill) // stock
                fill.color = 0xFF2B2B2B.toInt(); c.drawRect(8f, -3f, l, -0.5f, fill)
                fill.color = 0xFF8A5A2B.toInt(); c.drawRect(12f, -0.5f, 21f, 2f, fill) // pump
            }
            "sniper" -> {
                fill.color = 0xFF3A4A3A.toInt(); c.drawRect(-6f, -3f, 10f, 2f, fill)
                fill.color = 0xFF1F1F1F.toInt(); c.drawRect(10f, -2.5f, l, -0.5f, fill)
                fill.color = 0xFF111111.toInt(); c.drawRect(12f, -7f, 24f, -4f, fill) // scope
                fill.color = 0xFF66CCFF.toInt(); c.drawRect(23f, -6.5f, 24f, -4.5f, fill)
            }
            else -> { // rocket launcher
                fill.color = 0xFF5A5F66.toInt(); c.drawRect(-4f, -5f, l, 0f, fill)
                fill.color = 0xFF7A2222.toInt(); c.drawRect(l - 6f, -6f, l + 2f, 1f, fill)
                fill.color = 0xFF222222.toInt(); c.drawRect(8f, 0f, 12f, 6f, fill)
            }
        }
    }

    private fun drawBars(c: Canvas, f: Fighter) {
        val x = f.x - 20f
        val y = f.y - 40f
        fill.color = 0x99000000.toInt(); c.drawRect(x, y, x + 40f, y + 5f, fill)
        fill.color = if (f.hp > 35f) 0xFF22C55E.toInt() else 0xFFEF4444.toInt()
        c.drawRect(x, y, x + 40f * max(0f, f.hp) / MAX_HP, y + 5f, fill)
        if (f === game.player) {
            fill.color = 0xFFF59E0B.toInt(); c.drawRect(x, y + 7f, x + 40f * f.fuel / MAX_FUEL, y + 10f, fill)
        }
    }

    private fun label(c: Canvas, s: String, x: Float, y: Float, size: Float, align: Paint.Align = Paint.Align.LEFT) {
        text.textSize = size; text.textAlign = align
        text.style = Paint.Style.STROKE; text.strokeWidth = size / 6f; text.color = Color.BLACK
        c.drawText(s, x, y, text)
        text.style = Paint.Style.FILL; text.color = Color.WHITE
        c.drawText(s, x, y, text)
    }

    private fun drawHud(c: Canvas) {
        val p = game.player
        val w = p.weapon
        val ammo = if (p.reloadUntil > 0f) "RELOADING %.1fs".format(p.reloadUntil - game.time) else "${p.ammo}/${w.mag}"
        label(c, "HP ${max(0, kotlin.math.ceil(p.hp).toInt())}  FUEL ${kotlin.math.ceil(p.fuel).toInt()}", 16f, 30f, 20f)
        label(c, "${w.name}  $ammo", 16f, 56f, 20f)
        val alt = p.altWeapon?.let { "  Alt: ${it.name} ${p.altAmmo}" } ?: ""
        label(c, "Grenades ${p.grenades}$alt", 16f, 82f, 20f)
        label(c, "First to $KILL_LIMIT", 16f, 134f, 20f)
        var y = 160f
        for (f in game.fighters.sortedByDescending { it.kills }) {
            label(c, "${f.name.padEnd(6)} ${f.kills}", 16f, y, 20f); y += 26f
        }
        label(c, game.map.name, vw / 2, 28f, 22f, Paint.Align.CENTER)
        val win = game.winner
        if (game.over && win != null) label(c, "${win.name} wins! Tap to play again", vw / 2, 330f, 44f, Paint.Align.CENTER)
        else if (p.dead) label(c, "You died - respawning...", vw / 2, 330f, 44f, Paint.Align.CENTER)
    }

    private fun drawTouch(c: Canvas) {
        for ((cy, s) in listOf(40f to "R", 110f to "S", 180f to "G")) {
            fill.color = 0x88000000.toInt(); c.drawCircle(vw - 70f, cy, 32f, fill)
            label(c, s, vw - 70f, cy + 10f, 30f, Paint.Align.CENTER)
        }
        val sticks: List<Pair<Stick?, Int>>
        synchronized(lock) { sticks = listOf(left to Color.WHITE, right to 0xFFFF7755.toInt()) }
        for ((s, col) in sticks) {
            if (s == null) continue
            val (ax, ay) = s.axis()
            stroke.color = col; stroke.alpha = 128; stroke.strokeWidth = 3f
            c.drawCircle(s.ox, s.oy, STICK_R, stroke); stroke.alpha = 255
            fill.color = col; fill.alpha = 128
            c.drawCircle(s.ox + ax * STICK_R, s.oy + ay * STICK_R, 28f, fill); fill.alpha = 255
        }
    }
}
