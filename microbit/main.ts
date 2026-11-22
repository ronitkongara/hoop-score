/**
 * Hoop Score: micro:bit hoop (Bluetooth demo)
 *
 * Sends a basket to the Hoop Score app over Bluetooth.
 *   Button A  = fake basket (great for demos, works with no sensor)
 *   Button B  = re-learn the sensor baseline (keep the hoop clear)
 *   Sensor    = optional 3.3 V ultrasonic sensor: TRIG -> P1, ECHO -> P2, VCC -> 3V, GND -> GND
 *
 * LEDs: centre dot = connected to the app. Tick = basket sent.
 *       Bottom-left dot = no sensor found (button A still works).
 *
 * Setup in MakeCode (makecode.microbit.org):
 *   1. Extensions -> add "bluetooth" (it replaces "radio", that's expected)
 *   2. Gear -> Project Settings -> "No Pairing Required: Anyone can connect via Bluetooth" -> Save
 *   3. Paste this file into the JavaScript tab, then Download and copy the .hex to the micro:bit
 */

// ---- settings you can change ----
const USE_SENSOR = true      // false = button A only
const SHOW_LEDS = true       // false = keep the LED grid dark
const TRIG = DigitalPin.P1
const ECHO = DigitalPin.P2
const POLL_MS = 40
const MAX_HOLD_MS = 600      // longer than this is not a ball (hand on the net): ignored
const MIN_BELOW = 2          // readings in a row needed for a basket

// thresholds (the app sends its own values when it connects)
let dropCm = 15
let minHoldMs = 40
let cooldownMs = 2000

// ---- state ----
let connected = false
let statusOn = false
let sensorOk = false
let baseline = -1
let lastDist = -1
let cooldownUntil = 0
let inEvent = false
let eventStart = 0
let belowCount = 0
let blocked = false
let recalRequested = false
let lastStatus = 0

function send(line: string) {
    if (connected) bluetooth.uartWriteLine(line)
}

function sendConfig() {
    send("C," + dropCm + "," + minHoldMs + "," + cooldownMs)
}

function showIdle() {
    if (!SHOW_LEDS) { basic.clearScreen(); return }
    basic.clearScreen()
    if (connected) led.plot(2, 2)
    if (USE_SENSOR && !sensorOk) led.plot(0, 4)
}

// distance in cm, or -1 for no echo / out of range
function readCm(): number {
    pins.digitalWritePin(TRIG, 0)
    control.waitMicros(2)
    pins.digitalWritePin(TRIG, 1)
    control.waitMicros(10)
    pins.digitalWritePin(TRIG, 0)
    const us = pins.pulseIn(ECHO, PulseValue.High, 25000)
    if (us <= 0) return -1
    const cm = Math.round(us / 5.8) / 10
    if (cm < 2 || cm > 400) return -1
    return cm
}

// Learn the "nothing in the hoop" distance. Only trusts steady readings,
// so a missing or loose sensor turns detection off instead of firing randomly.
function calibrate() {
    sensorOk = false
    baseline = -1
    inEvent = false
    if (!USE_SENSOR) { showIdle(); return }
    if (SHOW_LEDS) basic.showIcon(IconNames.SmallDiamond, 0)
    const samples: number[] = []
    const start = input.runningTime()
    while (input.runningTime() - start < 2000) {
        const d = readCm()
        if (d > 0) samples.push(d)
        basic.pause(POLL_MS)
    }
    if (samples.length >= 15) {
        samples.sort((a, b) => a - b)
        const cut = Math.idiv(samples.length, 5)
        const lo = samples[cut]
        const hi = samples[samples.length - 1 - cut]
        if (hi - lo <= 10) {
            baseline = samples[Math.idiv(samples.length, 2)]
            sensorOk = true
        }
    }
    showIdle()
}

function score() {
    cooldownUntil = input.runningTime() + cooldownMs
    send("S")
    if (SHOW_LEDS) {
        basic.showIcon(IconNames.Yes, 0)
        control.inBackground(function () {
            basic.pause(600)
            showIdle()
        })
    }
}

// Same rules as the ESP32 hoop: a basket is a short dip below the baseline
// that lasts at least minHoldMs and leaves within MAX_HOLD_MS. Then a cooldown.
function processReading(d: number, now: number) {
    if (d < 0 || baseline <= 0) return
    if (now < cooldownUntil) { inEvent = false; return }
    const below = d < baseline - dropCm
    if (below) {
        if (!inEvent) { inEvent = true; blocked = false; eventStart = now; belowCount = 0 }
        belowCount += 1
        if (now - eventStart > MAX_HOLD_MS) blocked = true
    } else if (inEvent) {
        const hold = now - eventStart
        inEvent = false
        if (!blocked && belowCount >= MIN_BELOW && hold >= minHoldMs && hold <= MAX_HOLD_MS) score()
    }
}

// ---- Bluetooth ----
bluetooth.onBluetoothConnected(function () {
    connected = true
    showIdle()
    sendConfig()
})
bluetooth.onBluetoothDisconnected(function () {
    connected = false
    statusOn = false
    showIdle()
})
bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    const line = bluetooth.uartReadUntil(serial.delimiters(Delimiters.NewLine)).trim()
    if (line == "R") {
        recalRequested = true
    } else if (line == "W1") {
        statusOn = true
    } else if (line == "W0") {
        statusOn = false
    } else if (line.charAt(0) == "T") {
        const p = line.split(",")
        if (p.length == 4) {
            dropCm = Math.constrain(parseInt(p[1]), 3, 100)
            minHoldMs = Math.constrain(parseInt(p[2]), 10, 500)
            cooldownMs = Math.constrain(parseInt(p[3]), 500, 10000)
        }
        sendConfig()
    }
})
bluetooth.startUartService()

// ---- buttons ----
input.onButtonPressed(Button.A, function () {
    score()
})
input.onButtonPressed(Button.B, function () {
    recalRequested = true
})

// ---- main loop ----
pins.setPull(ECHO, PinPullMode.PullDown) // no sensor plugged in = reads nothing, never random
calibrate()
basic.forever(function () {
    if (recalRequested) {
        recalRequested = false
        calibrate()
    }
    const now = input.runningTime()
    if (sensorOk) {
        lastDist = readCm()
        processReading(lastDist, now)
    }
    if (statusOn && now - lastStatus >= 500) {
        lastStatus = now
        send("D," + lastDist + "," + baseline)
    }
    basic.pause(POLL_MS)
})
