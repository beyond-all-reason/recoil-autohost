// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { Deque } from '@js-sdsl/deque';

type EventCallback<T> = (time: number, ev: T) => Promise<void>;

/**
 * Returns the first value in range [`from`; `to`) for which the given
 * `predicate` returns `true`, or `to` when not found.
 *
 * Requirements:
 *   - The predicate must be monotonically increasing (from false to true) in
 *     the range.
 *   - `from` <= `to`.
 */
export function binarySearch(from: number, to: number, predicate: (n: number) => boolean): number {
	let len = to - from;
	while (len > 0) {
		const off = (len / 2) | 0;
		if (predicate(from + off)) {
			len = off;
		} else {
			from += off + 1;
			len -= off + 1;
		}
	}
	return from;
}

/**
 * Errors thrown from `EventsBuffer.subscribe`.
 */
export class EventsBufferError extends Error {
	constructor(
		public readonly type: 'callback_already_set' | 'too_far_in_the_past',
		msg: string,
	) {
		super(msg);
		this.name = 'EventsBufferError';
	}
}

/**
 * EventsBuffer accepts new events via the `push` method and queues them inside
 * of internal memory queue to later republish them via a callback set via the
 * `subscribe` method.
 *
 * Every event gets an unique monotonically increasing timestamp and the main
 * feature of the structure is that subscription can start in the past which
 * will cause all the past and future to be published via callback.
 *
 * The callback must return a promise that can't reject, and pusher awaits on
 * which allows to provide backpressure.
 *
 * To stop the publishing one needs only to unsubscribe the callback.
 *
 * **WARNING**: This class uses time at **microsecond** level, not the language default
 * which is millisecond.
 */
export class EventsBuffer<T> {
	private callback: EventCallback<T> | null = null;
	private pusherRunning: boolean = false;
	private pusherEventsIdx: number = 0;
	private lastDropTime: number = 0;
	private events: Deque<{ time: number; event: T }> = new Deque();

	/**
	 * Construct new EventsBuffer.
	 *
	 * @param maxAge Max age in microseconds for how long to keep the events.
	 *     Subscription will fail if asked for events older then `now() - maxAge`.
	 * @param droppingFrequency Time in microseconds, for maximum interval of
	 *     dropping old events from the queue. The value is to reduce overhead
	 *     of removing old elements.
	 */
	constructor(
		private maxAge: number,
		private droppingFrequency: number = (maxAge / 10) | 0,
	) {}

	/**
	 * Subscribe to event updates since specified time.
	 *
	 * @param since Callback will receive all events with timestamp > since.
	 *     Value needs to be in in microseconds.
	 * @param callback The callback to push new events to.
	 * @throws EventsBufferError if callback is already set of since is too high.
	 */
	subscribe(since: number, callback: EventCallback<T>) {
		if (this.callback !== null) {
			throw new EventsBufferError(
				'callback_already_set',
				'callback already set, unsubscribe first',
			);
		}
		if (since < Date.now() * 1000 - this.maxAge) {
			throw new EventsBufferError(
				'too_far_in_the_past',
				`since is too far in the past, max age is ${(this.maxAge / (1000 * 1000)) | 0}s`,
			);
		}

		this.callback = callback;
		const subStartIdx =
			binarySearch(
				0,
				this.events.length,
				(n) => this.events.getElementByPos(n).time <= since,
			) - 1;
		if (subStartIdx >= 0) {
			this.startPusher(subStartIdx);
		}
	}

	/**
	 * Remove the currently subscribed callback.
	 */
	unsubscribe() {
		this.callback = null;
	}

	/**
	 * Add a new event to the buffer.
	 *
	 * @param event Event
	 */
	push(event: T) {
		let time = Date.now() * 1000;
		if (!this.events.empty() && this.events.front()!.time >= time) {
			time = this.events.front()!.time + 1;
		}
		this.events.pushFront({ time, event });
		this.pusherEventsIdx += 1; // Because pusher worker moves from back to front.
		this.startPusher(0);
		this.maybeDropOlderThen(time - this.maxAge);
	}

	/**
	 * Length is simply number of events still in the buffer.
	 *
	 * Useful primarily for tests.
	 */
	get length(): number {
		return this.events.length;
	}

	private maybeDropOlderThen(after: number) {
		if (after > this.lastDropTime + this.droppingFrequency) {
			let pos =
				binarySearch(
					0,
					this.events.length,
					(n) => this.events.getElementByPos(n).time <= after,
				) - 1;
			// Don't drop events not processed by pusher yet.
			if (this.pusherRunning) {
				pos = Math.max(pos, this.pusherEventsIdx);
			}
			this.events.cut(pos); // Looking at current implementation, it's O(1)
			this.lastDropTime = after;
		}
	}

	private startPusher(fromIdx: number) {
		if (this.pusherRunning || !this.callback) return;
		this.pusherEventsIdx = fromIdx;
		this.pusherRunning = true;
		process.nextTick(async () => {
			while (this.pusherEventsIdx >= 0 && this.callback) {
				const { time, event } = this.events.getElementByPos(this.pusherEventsIdx--);
				await this.callback(time, event); // must not throw, if it does, crash is appropriate.
			}
			this.pusherRunning = false;
		});
	}
}
