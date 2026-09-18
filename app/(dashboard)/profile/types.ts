export type ProfileActionState = {
  status: "idle" | "success" | "error";
  message: string;
  user?: {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string | null;
    image: string | null;
  };
};

export const initialProfileActionState: ProfileActionState = {
  status: "idle",
  message: "",
};
