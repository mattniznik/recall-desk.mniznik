// What the system map should play, handed over by whatever is playing a run: the Examples tab
// (a recorded run, as its trace rows appear), the live chat (each event as it streams), or a
// layout's own run list. One run at a time; a new id starts the map over, the same id with more
// events carries it on. A module-level store, so the desk and the map need no shared parent.

import { useSyncExternalStore } from "react";

import type { MapEvent } from "./system-map.ts";

export type Feed = {
  id: string;
  title: string;
  mode: "replay" | "live";
  events: MapEvent[];
  // true while the events arrive a few at a time (the Examples tab, a live answer): the map
  // then hurries through a backlog to stay with them; a whole run handed over at once plays at
  // an even pace
  stream?: boolean;
};

let current: Feed | null = null;
const listeners = new Set<() => void>();

export function publish(feed: Feed) {
  current = feed;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The run the map should show, or null before anything has played. */
export function useFeed(): Feed | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

// "Take the tour" buttons outside the map (a hero, a nav) ask the map to start it.
let tours = 0;
const tourListeners = new Set<() => void>();

export function requestTour() {
  tours++;
  for (const l of tourListeners) l();
}

/** A count that goes up each time a tour is asked for. */
export function useTourRequests(): number {
  return useSyncExternalStore(
    (l) => {
      tourListeners.add(l);
      return () => tourListeners.delete(l);
    },
    () => tours,
    () => 0,
  );
}
