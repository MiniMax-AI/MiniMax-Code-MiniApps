import { randomUUID } from "node:crypto";

export class EventHub {
  #clients = new Map();

  subscribe(tripId, response) {
    const clients = this.#clients.get(tripId) ?? new Set();
    clients.add(response);
    this.#clients.set(tripId, clients);

    response.write(
      `event: connected\ndata: ${JSON.stringify({ trip_id: tripId })}\n\n`
    );

    return () => {
      clients.delete(response);
      if (clients.size === 0) this.#clients.delete(tripId);
    };
  }

  publish(type, trip, payload = {}) {
    const clients = this.#clients.get(trip.id);
    if (!clients || clients.size === 0) return;
    const event = {
      id: randomUUID(),
      type,
      trip_id: trip.id,
      revision: trip.revision,
      occurred_at: new Date().toISOString(),
      payload
    };
    const message = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const response of clients) response.write(message);
  }

  closeAll() {
    for (const clients of this.#clients.values()) {
      for (const response of clients) response.end();
    }
    this.#clients.clear();
  }
}
