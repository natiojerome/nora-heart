import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryConsentPolicy } from "../src/app/memory-policy.ts";
import { memoryInstructions } from "../src/app/memory-instructions.ts";
import { MemoryReview } from "../src/modules/memory/review/index.ts";
import { structuredMemoryFixture } from "./structured-memory-fixture.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import type { ModelProvider, ModelResponse } from "../src/contracts/models.ts";

// Verify that primary and review receive the same owner policy. This is wiring,
// not a simulated assertion of an LLM's real semantic decision.
test("ordinary personal facts and genuine sensitivity use one policy in both model stages", async () => {
  assert(memoryInstructions.includes(memoryConsentPolicy));
  assert.match(
    memoryConsentPolicy,
    /information personnelle n’est pas automatiquement/,
  );
  assert.match(
    memoryConsentPolicy,
    /sans formulaire ni demande de confirmation/,
  );
  const { memory } = structuredMemoryFixture();
  let calls = 0;
  const review = new MemoryReview(memory, null, memoryConsentPolicy);
  const provider: ModelProvider = {
    id: "simulated-review",
    async generate(request): Promise<ModelResponse> {
      calls++;
      assert(request.instructions.includes(memoryConsentPolicy));
      return {
        content: "",
        toolCalls: [
          {
            id: "assessment",
            name: "memory.assess",
            arguments: {
              decisions: [
                {
                  action: "remember",
                  evidence: "Mon épouse s’appelle Camille.",
                  note: "Prénom et lien utiles à la continuité.",
                  arguments: {
                    title: "Épouse",
                    content: "L’épouse de la personne s’appelle Camille.",
                    kind: "fact",
                    scope: "personal",
                  },
                },
              ],
            },
          },
        ],
      };
    },
  };
  const result = await review.review({
    provider,
    request: {
      instructions: memoryInstructions,
      messages: [{ role: "user", content: "Mon épouse s’appelle Camille." }],
      tools: structuredMemoryTools(memory, null),
    },
    response: { content: "Merci.", toolCalls: [] },
    contextWindow: 32768,
    reserveTokens: 4096,
  });
  assert.equal(calls, 1);
  assert.equal(result.response.toolCalls[0].name, "memory.remember");
  assert.equal(
    (await memory.list()).length,
    0,
    "the normal engine still owns execution",
  );
});
