import { z } from "zod";

export const assetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["svg", "image"]),
  src: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type Asset = z.infer<typeof assetSchema>;
