// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * MultiIndex is a n-way mapping between values. In mathematical sense,
 * it's a bijection between n-sets of values.
 *
 * Each of the sets has a name and type: modeled by the template type argument:
 *
 *   {
 *     'set_name1': type
 *     'set_name2': some_type2
 *   }
 *
 * The multi-index supports adding new elements and looking up values from all
 * the sets given the value from only one of them.
 */
export class MultiIndex<K extends object> {
	private m: { [key in keyof K]: Map<K[key], K> };

	/**
	 * Constructs a new MultiIndex.
	 *
	 * @param idx Any index key. It's not added to the multi-index, just needed
	 * because of the type erasure.
	 */
	constructor(private idx: K) {
		this.m = {} as typeof this.m;
		for (const k in idx) {
			this.m[k] = new Map();
		}
	}

	/**
	 * Tests if any of the values from the index key are already in the set.
	 */
	hasAny(idx: K): boolean {
		for (const k in idx) {
			if (this.m[k].has(idx[k])) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Tests if the whole index key is already in the set.
	 */
	hasAll(idx: K): boolean {
		for (const k in this.m) {
			const v = this.m[k].get(idx[k]);
			if (v) {
				for (const k in idx) {
					if (v[k] != idx[k]) {
						return false;
					}
				}
				return true;
			}
			break;
		}
		return false;
	}

	set(idx: K): boolean {
		if (this.hasAll(idx)) {
			return false;
		}
		if (this.hasAny(idx)) {
			throw new Error('Trying to set incompatible index key');
		}
		for (const k in idx) {
			this.m[k].set(idx[k], idx);
		}
		return true;
	}

	get<U extends keyof K>(set: U, key: K[U]): K | undefined {
		return this.m[set].get(key);
	}

	has<U extends keyof K>(set: U, key: K[U]): boolean {
		return this.m[set].has(key);
	}

	delete<U extends keyof K>(set: U, key: K[U]): boolean {
		const k = this.m[set].get(key);
		if (!k) {
			return false;
		}
		for (const i in k) {
			this.m[i].delete(k[i]);
		}
		return true;
	}

	get size(): number {
		for (const k in this.m) {
			return this.m[k].size;
		}
		return 0;
	}
}
