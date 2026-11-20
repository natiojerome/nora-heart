import { randomUUID } from "node:crypto";
import {
  TaskError,
  TaskBusy,
  type Task,
  type TaskRun,
  type TaskRepository,
  type TaskCalendar,
  type TaskExecution,
  type TaskRunStatus,
  type TaskDraft,
  type TaskService,
} from "../contracts/tasks.ts";
import type { ConversationRepository } from "../contracts/conversations.ts";
import type { SessionStore } from "../contracts/storage.ts";
import type { Conversations } from "./conversations.ts";
import { TaskProgress } from "./task-progress.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export class Tasks implements TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly calendar: TaskCalendar,
    private readonly conversations: ConversationRepository,
    private readonly execution: TaskExecution,
    private readonly now = () => new Date().toISOString(),
    private readonly sessions?: SessionStore,
  ) {}
  async list(options: { after?: string; limit?: number } = {}) {
    const limit = options.limit ?? 20;
    if ((options.after !== undefined && !uuid(options.after)) || !Number.isSafeInteger(limit) || limit < 1 || limit === Number.MAX_SAFE_INTEGER)
      throw new TaskError("Pagination des tâches invalide.");
    const rows = await this.repository.list({...options,limit:limit+1}), tasks = rows.slice(0,limit);
    const [latest,unread] = await Promise.all([this.repository.latest(tasks.map(task=>task.id)),this.repository.unread()]);
    const byTask = new Map(latest.map(run=>[run.task.id,run]));
    return {observedAt:this.now(),tasks:tasks.map(task=>({...task,lastRun:byTask.get(task.id)??null})),unread,
      nextCursor:rows.length>limit?tasks.at(-1)!.id:null};
  }
  private async require(id: string) {
    if (!uuid(id)) throw new TaskError("Tâche introuvable.");
    const task = await this.repository.get(id);
    if (!task) throw new TaskError("Tâche introuvable.");
    return task;
  }
  async get(id: string, before?: string, limit = 20) {
    const task = await this.require(id);
    if (
      (before !== undefined && !/^[1-9]\d*$/.test(before)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit === Number.MAX_SAFE_INTEGER
    )
      throw new TaskError("Pagination des tâches invalide.");
    const rows = await this.repository.runs(id, before, limit + 1),
      runs = rows.slice(0, limit);
    return {
      task,
      conversation: await this.conversations.get(task.conversationId),
      runs,
      nextCursor: rows.length > limit ? runs.at(-1)!.sequence : null,
    };
  }
  async create(body:TaskDraft,id:string) {
    if(!uuid(id))throw new TaskError("Identifiant de création invalide.");
    const existing=await this.repository.get(id);
    if(existing)return {task:existing};
    try{return await this.save({...body,version:0},id);}
    catch(error){const concurrent=await this.repository.get(id);if(concurrent)return {task:concurrent};throw error;}
  }
  async save(body: Record<string, unknown>,creationId?:string) {
    const id = body.id === undefined ? creationId ?? randomUUID() : body.id;
    if (
      !uuid(id) ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 0 ||
      typeof body.title !== "string" ||
      !body.title.trim() ||
      typeof body.prompt !== "string" ||
      !body.prompt.trim() ||
      !uuid(body.conversationId) ||
      typeof body.notify !== "boolean" ||
      typeof body.active !== "boolean" ||
      !["catch_up", "skip"].includes(String(body.missed))
    )
      throw new TaskError("Tâche invalide : vérifier les champs obligatoires.");
    const conversation = await this.conversations.get(body.conversationId);
    if (!conversation) throw new TaskError("Conversation introuvable.");
    if (!conversation.selection)
      throw new TaskError(
        "Choisir un modèle dans cette conversation avant de planifier.",
      );
    const previous = body.id ? await this.require(id) : null;
    if (previous && previous.version !== body.version)
      throw new TaskError("Tâche modifiée ailleurs. Recharge sa fiche.");
    const schedule = this.calendar.validate(body.schedule),
      now = this.now(),
      nextAt = body.active ? this.calendar.next(schedule, now) : null;
    if (body.active && !nextAt)
      throw new TaskError(
        "Échéance dépassée. Choisir une date future ou exécuter manuellement.",
      );
    return {
      task: await this.repository.save(
        {
          id,
          version: Number(body.version) + 1,
          title: body.title.trim(),
          prompt: body.prompt.trim(),
          conversationId: body.conversationId,
          schedule,
          missed: body.missed as Task["missed"],
          notify: body.notify,
          active: body.active,
          nextAt,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        },
        Number(body.version),
      ),
    };
  }
  async active(id: string, body: Record<string, unknown>) {
    const task = await this.require(id);
    if (typeof body.active !== "boolean")
      throw new TaskError("État de tâche invalide.");
    return this.save({ ...task, version: body.version, active: body.active });
  }
  async runNow(id: string, body: Record<string, unknown>) {
    await this.require(id);
    if (!uuid(body.executionId) || !Number.isSafeInteger(body.version))
      throw new TaskError("Identifiant d’exécution invalide.");
    return {
      run: await this.repository.enqueue(
        id,
        Number(body.version),
        body.executionId,
        this.now(),
      ),
    };
  }
  async result(id:string,runId:string,after?:string,limit=20) {
    await this.require(id);
    const run=await this.repository.getRun(runId);
    if(!run || run.task.id!==id)throw new TaskError("Résultat introuvable pour cette tâche.");
    if(!this.sessions)throw new TaskError("Lecture des résultats indisponible.");
    if((after!==undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(after)) || !Number.isSafeInteger(limit) || limit<1 || limit===Number.MAX_SAFE_INTEGER)throw new TaskError("Pagination des résultats invalide.");
    const messages:{id:string;at:string;content:string}[]=[];
    let found=after===undefined;
    const progress=new TaskProgress(this.sessions,run.task.conversationId,run.id,event=>{
      const data=event.data as {role?:string;content?:string;toolCalls?:unknown[]};
      if(event.type!=="message" || data.role!=="assistant" || data.toolCalls?.length || typeof data.content!=="string")return;
      if(!found){if(event.id===after)found=true;return;}
      if(messages.length<=limit)messages.push({id:event.id,at:event.at,content:data.content});
    });
    await progress.update();
    if(!found)throw new TaskError("Curseur de résultat introuvable.");
    const more=messages.length>limit,rows=messages.slice(0,limit);
    return {run,messages:rows,nextCursor:more?rows.at(-1)!.id:null};
  }
  async acknowledge(id: string, runId: string, body: Record<string, unknown>) {
    await this.require(id);
    const run = await this.repository.getRun(runId);
    if (!run || run.task.id !== id || run.status !== body.status)
      throw new TaskError("Résultat modifié. Actualise la tâche.");
    await this.repository.acknowledge(run.id, run.status);
    return { ok: true };
  }
  async resolve(id: string, runId: string) {
    await this.require(id);
    const run = await this.repository.getRun(runId);
    if (!run || run.task.id !== id || run.status !== "interrupted")
      throw new TaskError("Aucune occurrence interrompue à clôturer.");
    const state = await this.execution.inspect(run);
    if (
      (state && state.status === "interrupted") ||
      state?.status === "running"
    )
      throw new TaskError(
        "Réconcilier d’abord le travail dans la conversation.",
      );
    if (
      !(await this.repository.transition(run, {
        status: state?.status ?? "cancelled",
        detail:
          state?.detail ??
          "Réservation clôturée sans relance. Aucun tour trouvé dans le journal.",
        finishedAt: this.now(),
      }))
    )
      throw new TaskError("Résultat modifié. Actualise la tâche.");
    return { ok: true };
  }
}
export class ConversationTaskExecution implements TaskExecution {
  private progress = new Map<string, TaskProgress>();
  retain(ids: ReadonlySet<string>) { for (const id of this.progress.keys()) if(!ids.has(id)) this.progress.delete(id); }
  constructor(
    private readonly conversations: Conversations,
    private readonly sessions: SessionStore,
  ) {}
  async execute(run: TaskRun) {
    try {
      await this.conversations.sendScheduled(
        run.task.conversationId,
        run.task.prompt,
        run.id,
      );
    } catch (e) {
      const own = await this.inspect(run);
      if (
        !own &&
        e instanceof Error &&
        /travaille déjà|Réponds au formulaire/.test(e.message)
      )
        throw new TaskBusy();
      throw e;
    }
  }
  async inspect(
    run: TaskRun,
  ): Promise<{ status: TaskRunStatus; detail: string } | null> {
    let progress=this.progress.get(run.id);
    if(!progress) { progress=new TaskProgress(this.sessions,run.task.conversationId,run.id);this.progress.set(run.id,progress); }
    await progress.update();
    if(!progress.seen) return null;
    if(progress.cancelled) return {status:'cancelled',detail:'Demande annulée dans la conversation.'};
    if(progress.pending.size) return {status:'waiting',detail:'Une réponse est attendue dans la conversation.'};
    if(progress.last==='run.completed') return {status:'succeeded',detail:'Terminé. Résultat conservé dans la conversation.'};
    if(progress.last==='run.failed') return {status:'failed',detail:'Le tour a échoué ou a été arrêté. Vérifier la conversation avant une relance.'};
    if (this.conversations.isBusy(run.task.conversationId))
      return {
        status: "running",
        detail: "Travail en cours dans la conversation.",
      };
    return {
      status: "interrupted",
      detail:
        "Tour non terminé. Ouvrir la conversation et vérifier ses effets ; aucun rejeu automatique.",
    };
  }
}
