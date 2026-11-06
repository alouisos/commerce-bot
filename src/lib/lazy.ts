/**
 * A stand-in for an object built on first use. `next build` imports route modules to collect page
 * data without the runtime environment, so clients configured from env must not be created at
 * module load. Methods are bound to the real object.
 */
export function lazy<T extends object>(create: () => T): T {
  let value: T | undefined;
  const real = () => (value ??= create());
  return new Proxy({} as T, {
    get(_t, prop) {
      const target = real();
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
    has: (_t, prop) => Reflect.has(real(), prop),
    set: () => false,
  });
}
