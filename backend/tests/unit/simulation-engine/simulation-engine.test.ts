import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationClock } from "@/simulation-engine/core/simulation-clock.js";
import { EventQueue } from "@/simulation-engine/core/event-queue.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { describe, expect, it, vi } from "vitest";

function createEvent(id: string, timestampMs: number): SimulationEvent {
  return {
    id,
    simulationId: "simulation-1",
    timestampMs,
    type: "request.created",
  };
}

function createEngine() {
  const clock = new SimulationClock();
  const eventQueue = new EventQueue();
  const processEvent = vi.fn();

  const engine = new SimulationEngine(clock, eventQueue, processEvent);

  return { engine, clock, processEvent };
}

describe("SimulationEngine", () => {
  it("should process events in timestamp order and end at the last timestamp", () => {
    const { engine, processEvent } = createEngine();

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 20));
    engine.schedule(createEvent("event-c", 50));

    engine.run();

    const processedIds = processEvent.mock.calls.map(
      ([event]) => event.id,
    );

    expect(processedIds).toEqual(["event-b", "event-c", "event-a"]);
    expect(engine.getCurrentTime()).toBe(100);
  });

  it("should do nothing when the queue is empty and keep the clock at zero", () => {
    const { engine, processEvent } = createEngine();

    expect(() => engine.run()).not.toThrow();

    expect(processEvent).not.toHaveBeenCalled();
    expect(engine.getCurrentTime()).toBe(0);
  });

  it("should process already-ordered events without reordering", () => {
    const { engine, processEvent } = createEngine();

    engine.schedule(createEvent("event-1", 10));
    engine.schedule(createEvent("event-2", 20));
    engine.schedule(createEvent("event-3", 30));

    engine.run();

    const processedIds = processEvent.mock.calls.map(
      ([event]) => event.id,
    );

    expect(processedIds).toEqual(["event-1", "event-2", "event-3"]);
    expect(engine.getCurrentTime()).toBe(30);
  });

  it("should process unordered events in ascending timestamp order", () => {
    const { engine, processEvent } = createEngine();

    engine.schedule(createEvent("event-1", 30));
    engine.schedule(createEvent("event-2", 10));
    engine.schedule(createEvent("event-3", 20));

    engine.run();

    const processedIds = processEvent.mock.calls.map(
      ([event]) => event.id,
    );

    expect(processedIds).toEqual(["event-2", "event-3", "event-1"]);
    expect(engine.getCurrentTime()).toBe(30);
  });

  it("should never move the clock backwards while processing events", () => {
    const { engine, clock, processEvent } = createEngine();

    // Record the clock reading at the moment each event is processed.
    const processedTimes: number[] = [];

    processEvent.mockImplementation(() => {
      processedTimes.push(clock.now());
    });

    engine.schedule(createEvent("event-1", 30));
    engine.schedule(createEvent("event-2", 10));
    engine.schedule(createEvent("event-3", 20));

    engine.run();

    // The queue drains in ascending order, so every processing step happens
    // at (or after) the previous one — the clock is monotonic by construction.
    expect(processedTimes).toEqual([10, 20, 30]);

    for (let i = 1; i < processedTimes.length; i++) {
      expect(processedTimes[i]!).toBeGreaterThanOrEqual(processedTimes[i - 1]!);
    }
  });
});
