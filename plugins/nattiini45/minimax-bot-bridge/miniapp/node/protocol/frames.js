import { PROTOCOL_VERSION } from './types.js';
/** Thrown when a frame cannot be parsed or violates the contract. */
export class FrameError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'FrameError';
        this.code = code;
    }
}
let counter = 0;
/**
 * Frame id generator.
 *
 * Uses `crypto.randomUUID` where available (Node, browsers, Workers) and falls back to a
 * timestamp + counter + random suffix so the relay and the app never collide.
 */
export function newId(prefix = 'f') {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return `${prefix}_${cryptoObj.randomUUID()}`;
    }
    counter = (counter + 1) % 0xffff;
    const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
/** Builds a well-formed frame. */
export function createFrame(options) {
    const frame = {
        v: PROTOCOL_VERSION,
        id: options.id ?? newId(),
        ts: options.ts ?? Date.now(),
        type: options.type,
        source: options.source,
        payload: options.payload ?? {},
    };
    if (options.in_reply_to !== undefined)
        frame.in_reply_to = options.in_reply_to;
    if (options.opId !== undefined)
        frame.opId = options.opId;
    if (options.seq !== undefined)
        frame.seq = options.seq;
    return frame;
}
/** Serialises a frame for the wire. */
export function encodeFrame(frame) {
    return JSON.stringify(frame);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Parses and validates a frame.
 *
 * Validation is deliberately shallow: the contract is shared across three runtimes and a
 * strict deep validator would reject legitimate forward-compatible payloads. What is
 * enforced is everything the relay relies on to route and order frames.
 */
export function decodeFrame(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new FrameError('MALFORMED_JSON', 'frame is not valid JSON');
    }
    return assertFrame(parsed);
}
export function assertFrame(value) {
    if (!isRecord(value)) {
        throw new FrameError('NOT_AN_OBJECT', 'frame must be an object');
    }
    if (value.v !== PROTOCOL_VERSION) {
        throw new FrameError('UNSUPPORTED_VERSION', `unsupported protocol version: ${String(value.v)}`);
    }
    if (typeof value.id !== 'string' || value.id.length === 0) {
        throw new FrameError('MISSING_ID', 'frame.id must be a non-empty string');
    }
    if (typeof value.type !== 'string' || !value.type) {
        throw new FrameError('MISSING_TYPE', 'frame.type must be a non-empty string');
    }
    if (value.source !== 'app' && value.source !== 'bridge' && value.source !== 'relay') {
        throw new FrameError('BAD_SOURCE', `frame.source must be app|bridge|relay, got ${String(value.source)}`);
    }
    if (typeof value.ts !== 'number' || !Number.isFinite(value.ts)) {
        throw new FrameError('MISSING_TS', 'frame.ts must be a finite number');
    }
    if (value.payload === undefined) {
        throw new FrameError('MISSING_PAYLOAD', 'frame.payload is required');
    }
    if (value.seq !== undefined && (typeof value.seq !== 'number' || !Number.isInteger(value.seq))) {
        throw new FrameError('BAD_SEQ', 'frame.seq must be an integer when present');
    }
    if (value.from !== undefined && typeof value.from !== 'string') {
        throw new FrameError('BAD_FROM', 'frame.from must be a string when present');
    }
    if (value.in_reply_to !== undefined && typeof value.in_reply_to !== 'string') {
        throw new FrameError('BAD_IN_REPLY_TO', 'frame.in_reply_to must be a string when present');
    }
    if (value.opId !== undefined && typeof value.opId !== 'string') {
        throw new FrameError('BAD_OP_ID', 'frame.opId must be a string when present');
    }
    return value;
}
/** True when the frame is an operation (a request that expects an ack or an err). */
export function isRequest(frame) {
    return frame.type.startsWith('op.');
}
/** True when the frame is an event (a notification that expects no reply). */
export function isEvent(frame) {
    return frame.type.startsWith('evt.');
}
//# sourceMappingURL=frames.js.map