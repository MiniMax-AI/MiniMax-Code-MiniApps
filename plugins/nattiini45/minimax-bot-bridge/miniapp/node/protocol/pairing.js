/**
 * Pairing and credential contract shared by the bridge, the relay and the app.
 *
 * The relay is a dumb pipe, so it never holds a MiniMax account credential. Pairing is a
 * one-time code exchange: the bridge asks the relay for a short code, the phone types it,
 * and the relay hands the phone a device-scoped token it can revoke from the desktop.
 */
export const PAIRING_CODE_LENGTH = 6;
/**
 * How long a pairing code stays usable.
 *
 * Ninety seconds was long enough for the owner to read a code off their own
 * screen and type it, and far too short for anybody else. A code that arrives
 * in a chat message has to survive the time it takes to open the app and find
 * the field, and a code that dies before it is typed is the same as no code at
 * all — the person is left with a client that refuses them.
 *
 * Five minutes is an ordinary pairing window. The code is still single use and
 * still rate limited, so the longer window does not give an attacker a second
 * chance with the same code: it only gives the legitimate owner time to reach
 * the keyboard.
 */
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
/** The shortest window a desktop may ask for. */
export const MIN_PAIRING_CODE_TTL_MS = 60_000;
/**
 * The longest window a desktop may ask for.
 *
 * Long enough for a code to survive a slow reader and a detour to the right
 * app, short enough that a code left on a screen does not stay useful for the
 * rest of the day.
 */
export const MAX_PAIRING_CODE_TTL_MS = 15 * 60_000;
/**
 * The window a code actually gets.
 *
 * A desktop may ask for a longer window — the relay is the only place that can
 * enforce one — but it cannot ask for a window the relay did not agree to, and
 * a request that is not a number at all falls back to the default rather than
 * to an unbounded one.
 */
export function resolvePairingCodeTtlMs(requested) {
    if (typeof requested !== 'number' || !Number.isFinite(requested)) {
        return PAIRING_CODE_TTL_MS;
    }
    const whole = Math.trunc(requested);
    return Math.min(MAX_PAIRING_CODE_TTL_MS, Math.max(MIN_PAIRING_CODE_TTL_MS, whole));
}
export const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Only digits, so the code is easy to read off a phone screen and type. */
const PAIRING_CODE_PATTERN = new RegExp(`^\\d{${PAIRING_CODE_LENGTH}}$`);
export function isValidPairingCode(code) {
    return PAIRING_CODE_PATTERN.test(code);
}
/** Generates a numeric pairing code with a uniform distribution. */
export function generatePairingCode(random = Math.random) {
    let code = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
        code += String(Math.floor(random() * 10));
    }
    return code;
}
export function describeRelayError(code) {
    switch (code) {
        case 'UNAUTHORIZED':
            return 'This device is not paired with this bridge.';
        case 'PAIRING_CODE_INVALID':
            return 'That pairing code is not valid.';
        case 'PAIRING_CODE_EXPIRED':
            return 'That pairing code expired. Ask the desktop for a new one.';
        case 'PAIRING_CODE_UNKNOWN':
            return 'No bridge is waiting for that pairing code.';
        case 'DEVICE_REVOKED':
            return 'This device was revoked from the bridge.';
        case 'BRIDGE_OFFLINE':
            return 'The desktop is offline. Start MiniMax Code and try again.';
        case 'RATE_LIMITED':
            return 'Too many attempts. Wait a moment and try again.';
        case 'ACCOUNT_OWNED':
            return 'This account already belongs to another desktop.';
        case 'BAD_REQUEST':
            return 'The request could not be understood.';
        default:
            return 'The relay refused the request.';
    }
}
//# sourceMappingURL=pairing.js.map