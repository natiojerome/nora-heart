/** Stable keys, independent of translated titles or the displayed assistant name. */
export type InstructionId =
  | "work"
  | "tasks"
  | "projects"
  | "projectReview"
  | "memory"
  | "memoryPolicy"
  | "development"
  | "yolo"
  | "display"
  | "math"
  | "progress"
  | "interactions"
  | "web"
  | "memoryReview"
  | "compression";
export type InstructionOverrides = Partial<Record<InstructionId, string>>;
