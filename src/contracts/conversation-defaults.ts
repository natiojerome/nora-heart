import type {ModelSelection} from './conversations.ts';
import type {FileAccess} from './files.ts';
/** Copied when a thread is created; later changes never rewrite existing threads. */
export interface ConversationDefaults {
  selection: ModelSelection | null;
  fileAccess: FileAccess;
  networkAccess: boolean;
}
