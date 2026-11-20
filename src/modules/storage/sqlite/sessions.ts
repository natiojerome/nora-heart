import {validateWindow} from "../../../contracts/history.ts";
import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import type { Event, SessionStore } from "../../../contracts/storage.ts";
import { RecoveryError } from "../../../contracts/recovery.ts";
import { all, one, run, transaction, json } from "./database.ts";
import { holdDeadOwner } from "./leases.ts";

function validate(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new Error("Identifiant de session invalide.");
}
function map(row: Record<string, unknown>): Event {
  return {
    id: String(row.id),
    at: String(row.occurred_at),
    runId: String(row.run_id),
    type: row.type as Event["type"],
    data: json(row.data),
  };
}
export function sqliteSessions(
  db: DatabaseSync,
  file: string,
  ownerId: string,
  assertOpen: () => void,
): Required<SessionStore> {
  function insert(id: string, event: Event) {
    const normalized = { ...event, at: new Date(event.at).toISOString() },
      existing = one(db, "SELECT * FROM events WHERE id=?", event.id);
    if (existing) {
      if (
        existing.session_id !== id ||
        !isDeepStrictEqual(map(existing), normalized)
      )
        throw new Error(
          "Identifiant d’événement réutilisé avec un contenu différent.",
        );
      return;
    }
    const row = one(
      db,
      "UPDATE sessions SET next_sequence=next_sequence+1 WHERE id=? RETURNING next_sequence",
      id,
    )!;
    run(
      db,
      "INSERT INTO events(id,session_id,sequence,run_id,occurred_at,type,data) VALUES(?,?,?,?,?,?,?)",
      event.id,
      id,
      Number(row.next_sequence),
      event.runId,
      normalized.at,
      event.type,
      JSON.stringify(event.data),
    );
  }
  function appendBatch(id: string, events: Event[]) {
    assertOpen();
    validate(id);
    transaction(db, () => {
      run(db, "INSERT INTO sessions(id) VALUES(?) ON CONFLICT DO NOTHING", id);
      for (const event of events) {
        if (
          one(
            db,
            "SELECT 1 FROM reconciled_runs WHERE session_id=? AND run_id=?",
            id,
            event.runId,
          )
        )
          throw new RecoveryError(
            "Ce travail a été réconcilié. Écriture tardive refusée.",
          );
        insert(id, event);
      }
    });
  }
  return {
    async read(id) {
      assertOpen();
      validate(id);
      return all(
        db,
        "SELECT * FROM events WHERE session_id=? ORDER BY sequence",
        id,
      ).map(map);
    },
    async page(id,input) {
      assertOpen();validate(id);const limit=validateWindow(input),cursor=input.before??input.after;
      const sequence=cursor==null?undefined:one(db,"SELECT sequence FROM events WHERE session_id=? AND id=?",id,cursor)?.sequence;
      if(cursor!=null&&sequence===undefined)throw new Error('Curseur introuvable dans ce fil.');
      const forward=input.after!==undefined;
      const rows=all(db,`SELECT * FROM events WHERE session_id=? ${sequence!==undefined?`AND sequence ${forward?'>':'<'} ?`:''} ORDER BY sequence ${forward?'ASC':'DESC'} LIMIT ?`,id,...(sequence!==undefined?[sequence as number]:[]),limit+1);
      const events=rows.slice(0,limit).map(map);if(!forward)events.reverse();
      return {events,before:events[0]?.id??null,after:events.at(-1)?.id??null,hasMore:rows.length>limit};
    },
    async append(id, event) {
      appendBatch(id, [event]);
    },
    async appendBatch(id, events) {
      appendBatch(id, events);
    },
    async claim(id, runId) {
      assertOpen();
      validate(id);
      transaction(db, () => {
        run(
          db,
          "INSERT INTO sessions(id) VALUES(?) ON CONFLICT DO NOTHING",
          id,
        );
        const count = run(
          db,
          `UPDATE sessions SET active_run=?,runtime_owner=? WHERE id=? AND(active_run IS NULL OR EXISTS(
     SELECT 1 FROM events e WHERE e.session_id=sessions.id AND e.run_id=sessions.active_run AND(e.type='interaction.requested' OR(e.type='interaction.resolved' AND json_extract(e.data,'$.response.status')='cancelled'))))`,
          runId,
          ownerId,
          id,
        );
        if (!count)
          throw new Error(
            "Cette session travaille déjà ou nécessite une réconciliation.",
          );
      });
    },
    async release(id, runId) {
      assertOpen();
      validate(id);
      run(
        db,
        "UPDATE sessions SET active_run=NULL,runtime_owner=NULL WHERE id=? AND active_run=?",
        id,
        runId,
      );
    },
    async recoveryClaim(id) {
      assertOpen();
      validate(id);
      return (
        (one(db, "SELECT active_run FROM sessions WHERE id=?", id)
          ?.active_run as string | null) ?? null
      );
    },
    async reconcile(id, lastEventId, events) {
      assertOpen();
      validate(id);
      transaction(db, () => {
        const current = one(
          db,
          "SELECT active_run,runtime_owner FROM sessions WHERE id=?",
          id,
        );
        const tail =
          one(
            db,
            "SELECT id FROM events WHERE session_id=? ORDER BY sequence DESC LIMIT 1",
            id,
          )?.id ?? null;
        if (tail !== lastEventId)
          throw new RecoveryError(
            "Le fil a changé. Actualise avant de réconcilier.",
          );
        const release = current?.active_run
          ? holdDeadOwner(file, current.runtime_owner as string | null)
          : () => {};
        try {
          if (!events.length)
            throw new RecoveryError("Aucune interruption à réconcilier.");
          for (const event of events) insert(id, event);
          for (const runId of new Set(events.map((e) => e.runId)))
            run(
              db,
              "INSERT INTO reconciled_runs(session_id,run_id) VALUES(?,?) ON CONFLICT DO NOTHING",
              id,
              runId,
            );
          run(
            db,
            "UPDATE sessions SET active_run=NULL,runtime_owner=NULL WHERE id=?",
            id,
          );
        } finally {
          release();
        }
      });
    },
  };
}
