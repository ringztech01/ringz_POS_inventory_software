export type WarehouseActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialWarehouseActionState: WarehouseActionState = {
  status: "idle",
  message: "",
};
