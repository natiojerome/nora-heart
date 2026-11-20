export interface InputOption { id: string; label: string; description?: string }
export interface InputQuestion {
  id: string; label: string; type: "single" | "multiple" | "text";
  description?: string; required?: boolean; options?: InputOption[];
  placeholder?: string; maxLength?: number; minSelections?: number; maxSelections?: number;
}
export interface InputRequest {
  kind: "input_request"; title: string; description?: string;
  questions: InputQuestion[]; submitLabel?: string;
}
export interface InputResponse {
  status: "answered" | "cancelled";
  answers: Record<string, string | string[]>;
}
export interface Interaction {
  id: string; callId: string; toolName: string; at: string;
  request: InputRequest; status: "pending" | "answered" | "cancelled";
  response?: InputResponse;
  respondedAt?: string;
}
export interface ResumeInput { requestId: string; response: InputResponse }
