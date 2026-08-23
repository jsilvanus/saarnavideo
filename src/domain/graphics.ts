import { z } from "zod";

export const graphicLayerSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "rect", "ellipse", "image", "svg"]),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().default(100),
  height: z.number().positive().default(100),
  rotation: z.number().default(0),
  text: z.string().optional(),
  src: z.string().optional(),
  assetId: z.string().optional(),
  animation: z.string().optional(),
  style: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

export const graphicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  backgroundColor: z.string().default("#111111"),
  layers: z.array(graphicLayerSchema).default([]),
});

export type GraphicLayer = z.infer<typeof graphicLayerSchema>;
export type Graphic = z.infer<typeof graphicSchema>;
