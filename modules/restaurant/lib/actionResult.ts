// What every restaurant server action returns. Actions never throw to the
// browser: refusals and unexpected failures both come back as { ok: false }.
export type ActionFailure<F extends string = string> = {
  ok: false;
  error: string;
  fieldErrors?: Partial<Record<F, string[]>>;
};

export type ActionResult<F extends string = string> = { ok: true } | ActionFailure<F>;

export const FIX_ERRORS = "Please fix the errors below.";

export function invalid<F extends string>(fieldErrors: Partial<Record<F, string[]>>): ActionFailure<F> {
  return { ok: false, error: FIX_ERRORS, fieldErrors };
}
