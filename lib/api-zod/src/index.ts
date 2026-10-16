export * from "./generated/api";
export { z, default as zod } from "zod";
export * from './generated/types';

import { default as zod } from "zod";

export const RegisterAccountBody = zod.object({
  name: zod.string().min(2, "Name must be at least 2 characters").max(100),
  email: zod.string().email("Please enter a valid email address"),
  password: zod.string().min(8, "Password must be at least 8 characters").max(256),
  profession: zod.string().optional(),
});
export type RegisterAccountBody = zod.infer<typeof RegisterAccountBody>;

export const LoginAccountBody = zod.object({
  email: zod.string().optional(),
  username: zod.string().optional(),
  password: zod.string().min(1, "Password is required").max(256),
});
export type LoginAccountBody = zod.infer<typeof LoginAccountBody>;

export const AuthUserSchema = zod.object({
  id: zod.string(),
  email: zod.string().nullable().optional(),
  name: zod.string().nullable().optional(),
  profession: zod.string().nullable().optional(),
});
export type AuthUser = zod.infer<typeof AuthUserSchema>;
