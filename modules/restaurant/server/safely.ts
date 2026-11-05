import "server-only";
import type { ActionFailure } from "../lib/actionResult";

const UNEXPECTED: ActionFailure<never> = { ok: false, error: "Something went wrong. Please try again." };

// Runs a server action's body. Anything unexpected (a DB outage, a bug) is
// logged here and becomes a friendly { ok: false } instead of an error thrown
// to the browser.
export async function safely<T>(action: string, body: () => Promise<T>): Promise<T | ActionFailure<never>> {
  try {
    return await body();
  } catch (error) {
    console.error(`[restaurant] ${action} failed:`, error);
    return UNEXPECTED;
  }
}

export type Widget<T> = { ok: true; data: T } | { ok: false };

// Loads one dashboard widget's data. A failure is logged here and becomes
// { ok: false }, so the page shows that widget's error and the rest.
export async function loadWidget<T>(name: string, load: Promise<T>): Promise<Widget<T>> {
  try {
    return { ok: true, data: await load };
  } catch (error) {
    console.error(`[restaurant] dashboard widget "${name}" failed:`, error);
    return { ok: false };
  }
}
