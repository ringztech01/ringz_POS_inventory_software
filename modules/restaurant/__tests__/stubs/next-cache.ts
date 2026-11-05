// DB tests run outside Next, where revalidatePath/revalidateTag throw (no
// request). Mapped over "next/cache" by tsconfig.dbtest.json; no-ops here.
export function revalidatePath(): void {}
export function revalidateTag(): void {}
