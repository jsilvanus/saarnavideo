import { z } from "zod";

export const graphicLayerSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  rotation: z.number().default(0),
  text: z.string().optional(),
  src: z.string().optional(),
  animation: z.string().optional(),
  style: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

export const graphicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  layers: z.array(graphicLayerSchema).default([]),
});

export type GraphicLayer = z.infer<typeof graphicLayerSchema>;
export type Graphic = z.infer<typeof graphicSchema>;
