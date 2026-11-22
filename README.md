# Hoop Score: calm scoring feedback

An ultrasonic sensor under the rim detects a basket. An ESP32 sends a message over its own Wi-Fi, and a phone shows a calm animation and plays a sound that the caregiver picked.

```
[Ultrasonic sensor] -> [ESP32] --Wi-Fi "HoopScore" + WebSocket--> [Phone browser at http://192.168.4.1]
```

There's nothing to install on the phone. It works on iPhone and Android.

For demos there is also a **micro:bit + Bluetooth** version (no ESP32 needed). See [micro:bit demo](#micro-bit-demo-bluetooth) below.

```
/firmware   PlatformIO project (ESP32, Arduino), the final hoop
/microbit   MakeCode program for the micro:bit demo hoop (Bluetooth)
/web        The phone app (plain HTML/CSS/JS, no build step)
/tools      build_hosted.py: bundles /web into one file for the Claude demo link
```

---

## micro:bit demo (Bluetooth)

```
[button A or ultrasonic sensor] -> [micro:bit on the hoop] --Bluetooth--> [phone/tablet browser]
```

**Open the app:** https://ronitkongara.github.io/hoop-score/ (GitHub Pages; Bluetooth only works on https pages).

| Screen device | Browser to use |
|---|---|
| iPhone or iPad | **Bluefy** (free on the App Store). Safari and Chrome on iPhone can't use Bluetooth. |
| Android phone or tablet | Chrome |
| Chromebook, Windows, Mac | Chrome or Edge |

### 1. Put the program on the micro:bit (once)
1. Go to https://makecode.microbit.org and start a **New Project**.
2. Click **Extensions** and add **bluetooth**. It replaces "radio"; that's expected.
3. Click the **gear** → **Project Settings** → turn on **"No Pairing Required: Anyone can connect via Bluetooth"** → **Save**.
4. Switch to the **JavaScript** tab, delete what's there, and paste in everything from [`microbit/main.ts`](microbit/main.ts).
5. Click **Download** and copy the `.hex` file onto the micro:bit drive (or use the "Connect device" pairing in MakeCode).

A micro:bit **V2** is recommended. V1 also works but has less memory for Bluetooth.

**Simpler alternative:** [`microbit/simple-hoop.ts`](microbit/simple-hoop.ts) is the original classroom sonar program (sonar extension, P1/P2, ball within 1–5 inches) switched from radio to Bluetooth. It only sends baskets; the phone's sensor settings panel stays blank with it. Add both the **sonar** and **bluetooth** extensions before pasting it.

### 2. Optional sensor
Button A on the micro:bit counts as a basket, so the demo works without any sensor.
To detect real baskets, use a **3.3 V** ultrasonic sensor (HC-SR04P, RCWL-1601, or a micro:bit sonar board; the classic HC-SR04 needs 5 V and won't work directly). You'll need an edge-connector breakout board:

```
Sensor VCC  -> micro:bit 3V
Sensor GND  -> micro:bit GND
Sensor TRIG -> P1
Sensor ECHO -> P2
```

The micro:bit learns the empty-hoop distance at power-on (keep the hoop clear for 2 s). Press **B** to re-learn it. If no sensor is found, a dot lights in the bottom-left corner and only button A scores.

### 3. Run the demo
1. Power the micro:bit with a battery pack.
2. On the phone, open the app link (in Bluefy on iPhone) and tap **Connect micro:bit**. Pick **BBC micro:bit [....]** from the list. The centre LED lights when it's connected.
3. Tap **Start**. Press **A** on the micro:bit (or drop a ball through the sensor): the phone plays the animation and sound, and the micro:bit shows a tick.
4. If Bluetooth drops, the app reconnects by itself; the corner dot is grey while it's reconnecting.

The sensor settings in **Caregiver settings → Hoop sensor** (live distance, Recalibrate, drop distance, hold time, cooldown) work with the micro:bit too.

---

## 1. Try the app without any hardware

Open `web/index.html` in a desktop browser. With no hoop connected it runs in practice mode, so you can use **Test score** in settings.

To get a fake basket every 5 seconds, add `?demo=1`:

```bash
cd web && python -m http.server 8000
```
Then open `http://localhost:8000/?demo=1`.

**Tap-to-score test mode:** in Settings → Try it, turn on *Tap-to-score test mode*, or add `?tap=1` to the URL. Then every tap on the play screen counts as a basket. It works with or without the hoop, shows a small "Test mode" label, and turns off on reload.

**Hosted web demo:** `python tools/build_hosted.py` bundles `/web` into a single page, `dist/hoop-score.html`, for the private web link. When the page runs from an https link it can't reach the hoop, so it starts in practice mode with tap-to-score on, and it hides microphone recording. Uploading a sound still works.

Other URL flags: `?fake=1` turns on practice mode without auto-scores. `?ws=192.168.4.1` connects to a hoop from a dev server.

---

## 2. Wiring

Parts: an ESP32 DevKit, an HC-SR04 sensor (or the waterproof JSN-SR04T for outdoors), and two resistors (1 kΩ and 2 kΩ).

The sensor's ECHO pin outputs **5 V**, and the ESP32 pins take only **3.3 V**. Put the voltage divider on ECHO or you can damage the ESP32.

```
 HC-SR04                    ESP32 DevKit
 ┌────────┐
 │  VCC   ├──────────────── VIN (5V)
 │  TRIG  ├──────────────── GPIO 5
 │  ECHO  ├──[ 1kΩ ]──┬──── GPIO 18
 │        │           │
 │        │        [ 2kΩ ]
 │        │           │
 │  GND   ├───────────┴──── GND
 └────────┘
```

You can change the pins in `firmware/include/config.h`.

**Mounting:** put the sensor under the rim, pointing across or down through the net. With nothing in the hoop it should read a steady distance (the "baseline"). A ball passing through causes a short dip. Keep the sensor out of the ball's path, and make sure the beam doesn't hit the net strings too close to the sensor.

**If you use the JSN-SR04T:** in `config.h`, set `POLL_MS 60` and `SENSOR_MIN_CM 22`. This sensor can't see anything closer than about 20 cm.

---

## 3. Flashing

1. Install [PlatformIO](https://platformio.org/install), either the VS Code extension or the CLI.
2. Edit `firmware/include/config.h` and change `WIFI_PASSWORD` (8 or more characters).
3. Plug in the ESP32 by USB, then run:

```bash
cd firmware
```
```bash
pio run -t upload
```
```bash
pio run -t uploadfs
```
```bash
pio device monitor
```

`uploadfs` copies the `/web` folder onto the board. **Run it again every time you change the web app.**

The serial monitor should print `baseline = ... cm`. Wave a hand through the beam and you should see exactly one `[score]` per pass. A hand held in place for longer than 0.6 s prints `[skip]` and is ignored on purpose.

### How detection works (biased against false alarms)
- On boot it measures for 2 s and takes the median reading as the baseline. **Keep the hoop clear while it powers up.**
- It reads the sensor every 30 ms and ignores zero or out-of-range readings.
- It counts a basket only when the reading stays more than `dropCm` below the baseline (default 15 cm) for at least `minHoldMs` (default 40 ms) and at least 2 readings in a row, and the object then **leaves** within 600 ms. Anything that stays in the beam longer, like a hand on the net or a child under the hoop, is ignored.
- After a basket it ignores everything for `cooldownMs` (default 2 s), so net bounce doesn't count twice.
- After 60 s with nothing happening, it slowly adjusts the baseline for drift, but only if the readings have been steady.
- You can change the thresholds in the app under **Settings → Hoop sensor**. The board saves them, so they survive a power cycle.

### Messages
ESP32 → phone: `{"type":"score","ts":…}`, `{"type":"status","baseline":…,"distance":…}` every 500 ms, and `{"type":"config",…}` when the phone connects.
Phone → ESP32: `{"type":"recalibrate"}` and `{"type":"setThresholds","dropCm":15,"minHoldMs":40,"cooldownMs":2000}`.

---

## 4. Caregiver guide (one page)

**Before the session**
1. Turn on the hoop and keep the net clear for 3 seconds.
2. On the phone, join the Wi-Fi network **HoopScore**. If the phone says "No internet connection", choose **Stay connected** or **Keep**. On Android you may also need to turn off mobile data so the phone doesn't switch away.
3. Open **http://192.168.4.1** in Safari or Chrome. It's handy to bookmark it.
4. Tap **Caregiver settings** and set things up the way they work best:
   - **Animation:** tap *Preview* to see each one. Then pick a color, a speed and a duration.
   - **Sound:** this starts as **Soft chime** at 40% volume. Tap *Preview* to hear the 14 built-in sounds. Choose **None (silent)** if a session should have no sound at all.
   - **Your own sound:** type a name, then tap **Upload file** (up to 10 s). On the hoop Wi-Fi, phones block the microphone inside web pages. To use your own voice, record it with the phone's Voice Memos or recorder app, save it to Files, and upload it. Uploaded sounds are leveled automatically.
   - **Volume:** set it here. Open **Volume ceiling** once and set the loudest level you would ever want (default 60%). The volume slider can never go above it.
   - Tap **Test score** to see and hear exactly what a basket will do.
5. Tap **Done**, then tap the big **Start** button. This turns sound on and goes full screen. Then hand over the phone or mount it.

**Keep the screen on.** Set the phone's auto-lock to **Never** for the session: on iPhone it's Settings → Display & Brightness → Auto-Lock, and on Android it's Settings → Display → Screen timeout.

**Keep the child in the app (iPhone).** Turn on Settings → Accessibility → **Guided Access**. Then, on the hoop page, triple-click the side button and tap Start. On Android, use **App pinning** (Settings → Security).

**Volume:** the phone's own volume buttons also affect loudness. On iPhone, also check the silent switch. Set the phone volume once with a Test score and leave it there.

**During play**
- The small dot in the bottom-left corner is green when the phone is connected to the hoop and grey when it isn't. It reconnects by itself. No pop-ups or error sounds ever appear.
- If baskets come quickly, the current animation finishes first and at most one more plays after it. Sounds never overlap.
- **To open settings:** press and hold the **top-right corner for 3 seconds**. A faint ring appears after 1 second. You can add a 4-digit PIN under *Lock*.

**If something is off**
- **It plays when there was no basket:** go to Settings → Hoop sensor and increase *Drop distance* or *Hold time*. Then tap **Recalibrate** with the hoop clear.
- **It misses baskets:** lower *Drop distance* a little, or point the sensor so the ball passes through the middle of the beam.
- **No sound:** check that the sound isn't set to *None*, check the phone volume and silent switch, and tap the screen once (phones sometimes pause sound after locking).

**Profiles:** save setups like "Calm day" or "Party mode" and switch between them with one tap. Profiles never change the volume ceiling.

All settings and sounds are saved on this phone, in this browser. They stay after a reload or restart. Clearing the browser data resets everything.

---

## 5. Acceptance test

1. Power the ESP32, connect the phone to `HoopScore`, and open `192.168.4.1`.
2. In settings, choose Soft glow, blue, Slow, 2.5 s, Soft chime at 40%, with the ceiling at 60%.
3. Tap Start and hand over the phone.
4. Shoot 20 baskets and 20 misses that hit the rim. **The target is 18 or more of the 20 baskets detected, and 0 false triggers.**
5. Check that no sound is louder than the preview and that nothing plays when no basket was made.

If the rim hits trigger it, the rim vibration is reaching the beam. Point the sensor further below the rim, or increase *Drop distance*.
