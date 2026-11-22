/**
 * Hoop micro:bit, simple version (your original sonar code, switched from radio to Bluetooth).
 * When the sonar sees the ball, it tells the Hoop Score app on the phone, which plays the
 * animation and sound. The phone replaces the second (receiver) micro:bit.
 *
 * MakeCode setup:
 *   - Extensions: sonar (you already have it) + bluetooth (this removes radio; that's expected)
 *   - Gear -> Project Settings -> "No Pairing Required: Anyone can connect via Bluetooth" -> Save
 *
 * LEDs: small square = waiting for the phone, big square = connected, happy face = basket sent.
 * Button A = test basket. Button B = show the count.
 */
const COOLDOWN_MS = 2000   // ignore the sonar for 2 s after a basket (net bounce)
let count = 0
let p = 0
let connected = false
let wasInRange = false
let lastScore = -COOLDOWN_MS

function showIdle() {
    if (connected) {
        basic.showIcon(IconNames.Square, 0)
    } else {
        basic.showIcon(IconNames.SmallSquare, 0)
    }
}

function scored() {
    count += 1
    lastScore = input.runningTime()
    if (connected) {
        bluetooth.uartWriteLine("S")
    }
    basic.showIcon(IconNames.Happy, 0)
    control.inBackground(function () {
        basic.pause(1000)
        showIdle()
    })
}

bluetooth.onBluetoothConnected(function () {
    connected = true
    showIdle()
})
bluetooth.onBluetoothDisconnected(function () {
    connected = false
    showIdle()
})
input.onButtonPressed(Button.A, function () {
    scored()
})
input.onButtonPressed(Button.B, function () {
    basic.showNumber(count)
    showIdle()
})

bluetooth.startUartService()
showIdle()

basic.forever(function () {
    p = sonar.ping(
        DigitalPin.P1,
        DigitalPin.P2,
        PingUnit.Inches
    )
    const inRange = p > 1 && p < 5
    // count once when the ball ENTERS the range, not every loop while it's there
    if (inRange && !wasInRange && input.runningTime() - lastScore > COOLDOWN_MS) {
        scored()
    }
    wasInRange = inRange
    basic.pause(30)
})
