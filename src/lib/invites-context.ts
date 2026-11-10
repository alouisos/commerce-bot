// The invite being accepted in this request, if any. Better Auth's user-creation hook only lets a new
// user through inside this context, so the public sign-up endpoint can't create anyone.
import { AsyncLocalStorage } from "node:async_hooks";

export type ActiveInvite = { id: string; accountId: string; email: string };

const store = new AsyncLocalStorage<ActiveInvite>();

export function runWithInvite<T>(invite: ActiveInvite, fn: () => Promise<T>): Promise<T> {
  return store.run(invite, fn);
}

export function currentInvite(): ActiveInvite | null {
  return store.getStore() ?? null;
}
