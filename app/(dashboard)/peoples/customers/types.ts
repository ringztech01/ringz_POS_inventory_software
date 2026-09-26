export type CustomerActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialCustomerActionState: CustomerActionState = {
  status: "idle",
  message: "",
};
