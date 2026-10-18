package com.example.minimilitia

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/** Procedurally generated sound effects (no copyrighted audio). */
class Sound(ctx: Context) : GameEvents {
    private val pool = SoundPool.Builder()
        .setMaxStreams(8)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).build())
        .build()
    private val ids = HashMap<String, Int>()

    init {
        val dir = ctx.cacheDir
        load(dir, "shoot", synth(0.07f, 600f, 200f, square = true, vol = 0.25f))
        load(dir, "heavy", synth(0.15f, 120f, 50f, square = true, vol = 0.6f, noise = 0.5f))
        load(dir, "explode", synth(0.5f, 90f, 30f, square = false, vol = 0.8f, noise = 0.8f))
        load(dir, "hit", synth(0.08f, 200f, 100f, square = false, vol = 0.3f))
        load(dir, "reload", synth(0.1f, 300f, 500f, square = false, vol = 0.3f))
        load(dir, "pickup", synth(0.15f, 500f, 900f, square = false, vol = 0.35f))
        load(dir, "die", synth(0.4f, 300f, 50f, square = false, vol = 0.4f))
    }

    private fun load(dir: File, name: String, pcm: ByteArray) {
        val f = File(dir, "sfx_$name.wav")
        f.writeBytes(wav(pcm))
        ids[name] = pool.load(f.absolutePath, 1)
    }

    private fun play(name: String) {
        ids[name]?.let { pool.play(it, 1f, 1f, 1, 0, 1f) }
    }

    fun release() = pool.release()

    override fun onShoot(heavy: Boolean) = play(if (heavy) "heavy" else "shoot")
    override fun onExplode(x: Float, y: Float, radius: Float) = play("explode")
    override fun onHit() = play("hit")
    override fun onDie() = play("die")
    override fun onReload() = play("reload")
    override fun onPickup() = play("pickup")

    private companion object {
        const val RATE = 22050

        fun synth(dur: Float, f0: Float, f1: Float, square: Boolean, vol: Float, noise: Float = 0f): ByteArray {
            val n = (RATE * dur).toInt()
            val out = ByteArrayOutputStream(n * 2)
            var phase = 0.0
            val rng = Random(1)
            for (i in 0 until n) {
                val t = i / n.toFloat()
                val freq = f0 * (f1 / f0).toDouble().pow(t.toDouble())
                phase += 2 * PI * freq / RATE
                val s = sin(phase)
                val tone = if (square) (if (s >= 0) 1.0 else -1.0) else s
                val nz = (rng.nextFloat() * 2 - 1) * noise
                val env = exp(-4.0 * t)
                val v = ((tone * (1 - noise) + nz) * env * vol * 32767).toInt().coerceIn(-32768, 32767)
                out.write(v and 0xFF); out.write((v shr 8) and 0xFF)
            }
            return out.toByteArray()
        }

        fun wav(pcm: ByteArray): ByteArray {
            val o = ByteArrayOutputStream()
            fun i32(v: Int) { for (k in 0..3) o.write((v shr (8 * k)) and 0xFF) }
            fun i16(v: Int) { for (k in 0..1) o.write((v shr (8 * k)) and 0xFF) }
            o.write("RIFF".toByteArray()); i32(36 + pcm.size)
            o.write("WAVEfmt ".toByteArray()); i32(16); i16(1); i16(1); i32(RATE); i32(RATE * 2); i16(2); i16(16)
            o.write("data".toByteArray()); i32(pcm.size); o.write(pcm)
            return o.toByteArray()
        }
    }
}
