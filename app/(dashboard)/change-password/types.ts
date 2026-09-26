export type ChangePasswordActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialChangePasswordActionState: ChangePasswordActionState = {
  status: "idle",
  message: "",
};
