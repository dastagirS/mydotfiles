declare const redactedBrand: unique symbol;

export interface Redacted<A> {
	readonly [redactedBrand]?: A;
	toString(): string;
	toJSON(): string;
}

const registry = new WeakMap<object, unknown>();

const proto = {
	toString() {
		return "<redacted>";
	},
	toJSON() {
		return "<redacted>";
	},
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return "<redacted>";
	},
};

function makeRedacted<A>(value: A): Redacted<A> {
	const redacted: Redacted<A> = Object.create(proto) as Redacted<A>;
	registry.set(redacted, value);
	return redacted;
}

function readRedactedValue<A>(self: Redacted<A>): A;
function readRedactedValue(self: unknown): unknown;
function readRedactedValue(self: unknown): unknown {
	if (typeof self !== "object" || self === null || !registry.has(self)) {
		throw new Error("Redacted value was not in registry");
	}
	return registry.get(self);
}

export const Redacted = {
	make: makeRedacted,
	value: readRedactedValue,
} as const;
