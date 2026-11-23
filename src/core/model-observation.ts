import type { ModelRequest, ModelResponse } from "../contracts/models.ts";
/** Portable UTF-8 text estimates, not provider billing or image token counts. No contents retained. */
export function modelInputSizes(request: ModelRequest) {
  const bytes = (v: unknown) =>
    Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
  const categories = {
    instructions: bytes(request.instructions),
    tools: bytes(request.tools),
    userText: 0,
    assistantText: 0,
    toolArguments: 0,
    toolResults: 0,
    attachmentText: 0,
  };
  let mediaBytes = 0;
  for (const m of request.messages) {
    if (m.role === "user") {
      categories.userText += bytes(m.content);
      for (const a of m.attachments ?? []) {
        if (
          a.data &&
          !a.mediaType.startsWith("image/") &&
          a.mediaType !== "application/pdf"
        )
          categories.attachmentText += Buffer.byteLength(
            Buffer.from(a.data, "base64"),
          );
        else mediaBytes += a.size;
      }
    } else if (m.role === "assistant") {
      categories.assistantText += bytes(m.content);
      categories.toolArguments += bytes(m.toolCalls);
    } else {
      categories.toolResults += bytes(m.content);
      for (const i of m.images ?? [])
        mediaBytes +=
          Math.floor((i.data.length * 3) / 4) -
          (i.data.endsWith("==") ? 2 : i.data.endsWith("=") ? 1 : 0);
    }
  }
  const textBytes = Object.values(categories).reduce((n, v) => n + v, 0);
  return {
    method: "utf8-bytes-div-3" as const,
    estimated: true,
    categories,
    textBytes,
    estimatedInputTokens: Math.ceil(textBytes / 3),
    mediaBytes,
  };
}
export function modelOutputSize(response: ModelResponse) {
  return Math.ceil(
    Buffer.byteLength(
      JSON.stringify({
        content: response.content,
        toolCalls: response.toolCalls,
      }),
      "utf8",
    ) / 3,
  );
}
