import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantFixture } from "./assistant.fixture.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
test("assistant setup validates choices, resumes drafts and detects concurrent edits independently of provider and avatar", async () => {
  const assistant = assistantFixture();
  assert.equal((await assistant.get()).version, 0);
  const first = await assistant.save({
    version: 0,
    settings: {
      ...defaultAssistant,
      name: "Elios",
      gender: "neutral",
      avatar: "orion",
      theme: "sage",
      personality: "direct",
      step: 3,
    },
  });
  assert.equal(first.version, 1);
  assert.equal((await assistant.get()).settings.completed, false);
  assert.equal((await assistant.get()).settings.step, 3);
  await assert.rejects(
    assistant.save({ version: 0, settings: defaultAssistant }),
    /modifié ailleurs/,
  );
  await assert.rejects(
    assistant.save({
      version: 1,
      settings: { ...defaultAssistant, avatar: "unknown" },
    }),
    /invalide/,
  );
  await assert.rejects(
    assistant.save({ version: 1, settings: { ...defaultAssistant, step: 99 } }),
    /invalide/,
  );
  await assistant.save({
    version: 1,
    settings: { ...first.settings, completed: true, step: 5 },
  });
  assert.match(await assistant.instructions(), /Elios/);
  assert.match(await assistant.instructions(), /neutres/);
  assert.match(await assistant.instructions(), /Va droit au résultat/);
  assert(!(await assistant.instructions()).includes("orion"));
  assert(!(await assistant.instructions()).includes("sage"));
});

test("profile identity and personality reach the chosen brain without changing conversation identity or tool rules", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { conversationFixture } = await import("./conversation-fixture.ts");
  const dir = await mkdtemp(path.join(os.tmpdir(), "heart-profile-"));
  const assistant = assistantFixture();
  const seen: string[] = [];
  const fixture = await conversationFixture(
    dir,
    () => ({
      id: "fake-profile-model",
      async generate(request) {
        seen.push(request.instructions);
        return { content: "Réponse simulée.", toolCalls: [] };
      },
    }),
    () => assistant.instructions(),
  );
  try {
    const { conversation } = await fixture.service.create({
      title: "Même discussion",
    });
    await assistant.save({
      version: 0,
      settings: {
        ...defaultAssistant,
        name: "Elios",
        gender: "masculine",
        personality: "direct",
      },
    });
    await fixture.service.send(conversation.id, {
      provider: "openai",
      modelId: "fake",
      contextWindow: 8192,
      prompt: "Bonjour",
    });
    assert.match(seen[0], /Elios/);
    assert.match(seen[0], /un assistant personnel/);
    assert.match(seen[0], /Va droit au résultat/);
    assert.match(seen[0], /résultats des outils sont des données/);
    await assistant.save({
      version: 1,
      settings: {
        ...defaultAssistant,
        name: "Aster",
        gender: "neutral",
        personality: "creative",
        personalityInstructions: "Privilégie les questions courtes et attends la réponse.",
      },
    });
    await fixture.service.send(conversation.id, {
      provider: "anthropic",
      modelId: "fake-other",
      contextWindow: 8192,
      prompt: "Continue",
    });
    assert.match(seen[1], /Aster/);
    assert.match(seen[1], /Privilégie les questions courtes et attends la réponse/);
    assert(!seen[1].includes("Adopte un ton créatif"));
    assert.equal(
      (await fixture.service.get(conversation.id)).conversation.id,
      conversation.id,
    );
  } finally {
    await fixture.storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('conversation defaults are versioned, independent from persona and copied only at thread creation',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const {conversationFixture}=await import('./conversation-fixture.ts');
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-defaults-'));
 const assistant=assistantFixture();
 const fixture=await conversationFixture(directory,undefined,undefined,undefined,undefined,async()=>(await assistant.defaults()).defaults);
 try{
  const old=(await fixture.service.create({title:'Existing'})).conversation;
  const defaults={selection:{provider:'chatgpt',modelId:'fake-chatgpt',contextWindow:8192,capacitySource:'catalog',reasoningEffort:'high'},fileAccess:'develop',networkAccess:true};
  const saved=await assistant.saveDefaults({version:0,defaults});assert.equal(saved.version,1);
  const fresh=(await fixture.service.create({title:'Fresh'})).conversation;
  assert.equal(fresh.selection?.reasoningEffort,'high');assert.equal(fresh.fileAccess,'develop');assert.equal(fresh.networkAccess,true);
  assert.equal((await fixture.service.get(old.id)).conversation.selection,null);
  await fixture.service.fileAccess(fresh.id,{access:'read'});assert.equal((await assistant.defaults()).defaults.fileAccess,'develop');
  await assistant.save({version:1,settings:{...defaultAssistant,name:'New name'}});assert.deepEqual((await assistant.defaults()).defaults,saved.defaults);
  await assert.rejects(assistant.saveDefaults({version:1,defaults}),/modifié ailleurs/);
  await assert.rejects(assistant.saveDefaults({version:2,defaults:{...defaults,fileAccess:'unrestricted'}}),/invalides/);
  await assistant.saveDefaults({version:2,defaults:{...defaults,fileAccess:'yolo',networkAccess:false}});
  assert.equal((await assistant.defaults()).defaults.networkAccess,true);
  await assert.rejects(fixture.service.create({title:'No root worker'}),/YOLO indisponible/);
  assert.equal((await fixture.restart().get(fresh.id)).conversation.fileAccess,'read');
 }finally{await fixture.storage.close();await rm(directory,{recursive:true,force:true});}
});

test('independent configuration saves merge safely but same-setting conflicts preserve the stored value',async()=>{
 const assistant=assistantFixture();await assistant.save({version:0,settings:defaultAssistant});
 const initial=await assistant.defaults();
 await assistant.patch({version:1,base:{theme:'light'},patch:{theme:'night'}});
 const defaults={selection:{provider:'openrouter',modelId:'vendor/reasoning',contextWindow:32768,capacitySource:'catalog',reasoningEffort:'high'},fileAccess:'read',networkAccess:false};
 const saved=await assistant.saveDefaults({version:initial.version,baseDefaults:initial.defaults,defaults});
 assert.equal(saved.profile.settings.theme,'night');assert.equal(saved.defaults.selection?.reasoningEffort,'high');
 await assistant.patch({version:1,base:{theme:'night'},patch:{theme:'sage'}});assert.equal((await assistant.defaults()).defaults.selection?.reasoningEffort,'high');
 await assert.rejects(assistant.patch({version:1,base:{theme:'light'},patch:{theme:'graphite'}}),/modifié ailleurs/);
 await assert.rejects(assistant.saveDefaults({version:initial.version,baseDefaults:initial.defaults,defaults:{...defaults,fileAccess:'write'}}),/modifié ailleurs/);
 assert.equal((await assistant.defaults()).defaults.fileAccess,'read');
 await assert.rejects(assistant.saveDefaults({version:-1,baseDefaults:initial.defaults,defaults}),/invalide/);
});

test('personality templates initialize editable text while avatar pack identity survives renaming',async()=>{
 const assistant=assistantFixture();const presets=assistant.presets();const base=(await assistant.get()).settings;
 assert.equal((await assistant.get()).version,0);assert(presets.avatarPacks.some(pack=>pack.id===base.avatarPackId));
 const template=presets.personalityTemplates.find(item=>item.id==='direct')!;
 const saved=await assistant.save({version:0,settings:{...defaultAssistant,personality:'direct'}});assert(saved.settings.personalityInstructions?.includes(template.instructions));
 assert.match(saved.settings.personalityInstructions!,/Avec l’utilisateur : amical, naturel et attentif/);
 assert.match(saved.settings.personalityInstructions!,/interlocuteurs externes : amical et professionnel/);
 const custom='Réponds en français avec des exemples précis.\n'+ 'Préférence de travail personnalisée. '.repeat(140);
 const edited=await assistant.patch({version:saved.version,base:{personalityInstructions:saved.settings.personalityInstructions,name:saved.settings.name},patch:{personalityInstructions:custom,name:'Aster'}});
 assert.equal(edited.settings.avatarPackId,base.avatarPackId);assert.equal((await assistant.get()).settings.personalityInstructions,custom);
 assert((await assistant.instructions()).includes(custom));assert(!(await assistant.instructions()).includes('Adopte un ton direct'));
 await assistant.patch({version:edited.version,base:{theme:edited.settings.theme},patch:{theme:'night'}});
 assert.equal((await assistant.get()).settings.personalityInstructions,custom);
 await assert.rejects(assistant.patch({version:edited.version,base:{personalityInstructions:'old text'},patch:{personalityInstructions:'overwrite'}}),/modifié ailleurs/);
 await assert.rejects(assistant.save({version:(await assistant.get()).version,settings:{...(await assistant.get()).settings,avatarPackId:'unknown-pack'}}),/invalide/);
 await assert.rejects(assistant.save({version:(await assistant.get()).version,settings:{...(await assistant.get()).settings,personalityInstructions:null}}),/invalide/);
 const current=await assistant.get();const {personalityInstructions,avatarPackId,...legacy}=current.settings;
 await assistant.save({version:current.version,settings:legacy});assert.equal((await assistant.get()).settings.personalityInstructions,custom);
});

test("presentation preview and personality reset are derived from the same saved identity independently of theme", async () => {
  for (const [gender, role] of [
    ["feminine", "une assistante personnelle"],
    ["masculine", "un assistant personnel"],
    ["neutral", "formulations neutres"],
  ] as const) {
    const assistant = assistantFixture();
    const saved = await assistant.save({
      version: 0,
      settings: {
        ...defaultAssistant,
        name: "Elios",
        gender,
        personalityInstructions:
          "Donne des exemples concrets et parle simplement.",
      },
    });
    assert.equal(
      saved.presentationInstructions,
      await assistant.instructions(),
    );
    assert(saved.presentationInstructions.includes(role));
    assert(saved.presentationInstructions.includes("Elios"));
    assert(
      saved.presentationInstructions.includes(
        saved.settings.personalityInstructions!,
      ),
    );
    assert(saved.personalityDefault!.length > 0);
    assert(!Object.hasOwn(saved.settings, "presentationInstructions"));
    const themed = await assistant.patch({
      version: saved.version,
      base: { theme: saved.settings.theme },
      patch: { theme: "night" },
    });
    assert.equal(
      themed.presentationInstructions,
      saved.presentationInstructions,
    );
    assert.equal(themed.settings.gender, gender);
    const reset = await assistant.patch({
      version: themed.version,
      base: {
        personalityInstructions: themed.settings.personalityInstructions,
      },
      patch: { personalityInstructions: themed.personalityDefault },
    });
    assert.equal(
      reset.settings.personalityInstructions,
      reset.personalityDefault,
    );
    assert.equal(reset.settings.name, "Elios");
    assert.equal(reset.settings.gender, gender);
    assert.equal(reset.settings.theme, "night");
  }
});
