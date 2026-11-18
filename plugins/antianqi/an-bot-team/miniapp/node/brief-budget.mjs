// @ts-check
// The agent port budget.
//
// One Bot may carry 52 kB of prompt; the four together 182 kB. The number counts what the
// model really receives: the identity files and the shared cards (the agent port) plus the
// two memory areas. The L3 layer does not count - it is read on demand and it is not in the
// prompt.
//
// The number lives in one place because two parties have to agree on it: the server refuses
// a write that would break the ceiling, and the checker reports a tree that already broke
// it. Two copies of the limit would drift apart, and then one of them would be wrong.

export const BRIEF_BYTES_MAX = 52000;
export const BRIEF_TOTAL_MAX = 182000;
