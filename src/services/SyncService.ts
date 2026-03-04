/**
 * SyncService – Background synchronization of pending local changes.
 *
 * Listens for `online` events and runs periodic checks.
 * Processes the sync_queue in FIFO order, retrying on failure.
 */

import { supabase } from "@/integrations/supabase/client";
import { localDb } from "./localDb";

const MAX_RETRIES = 5;
let isSyncing = false;

/**
 * Process all pending entries in the sync queue.
 */
export async function processSyncQueue(): Promise<{ processed: number; errors: number }> {
  if (isSyncing || !navigator.onLine) return { processed: 0, errors: 0 };
  isSyncing = true;

  let processed = 0;
  let errors = 0;

  try {
    const entries = await localDb.sync_queue
      .orderBy("_local_id")
      .toArray();

    for (const entry of entries) {
      if (!navigator.onLine) break; // Stop if we went offline mid-sync

      try {
        await syncEntry(entry);
        // Success: remove from queue and update local record status
        await localDb.sync_queue.delete(entry._local_id!);
        await markSynced(entry.table_name, entry.record_id, entry.operation);
        processed++;
      } catch (error: any) {
        errors++;
        const retryCount = entry.retry_count + 1;
        if (retryCount >= MAX_RETRIES) {
          console.error(`[SyncService] Max retries reached for ${entry.table_name}/${entry.record_id}`, error);
          // Keep in queue but don't retry automatically
          await localDb.sync_queue.update(entry._local_id!, {
            retry_count: retryCount,
            last_error: error?.message ?? "Unknown error",
          });
        } else {
          await localDb.sync_queue.update(entry._local_id!, {
            retry_count: retryCount,
            last_error: error?.message ?? "Unknown error",
          });
        }
      }
    }
  } finally {
    isSyncing = false;
  }

  if (processed > 0) {
    console.log(`[SyncService] Synced ${processed} records, ${errors} errors`);
  }

  return { processed, errors };
}

async function syncEntry(entry: {
  table_name: string;
  record_id: string;
  operation: string;
  payload: Record<string, unknown>;
}) {
  const { table_name, record_id, operation, payload } = entry;

  switch (operation) {
    case "INSERT": {
      const { error } = await supabase
        .from(table_name as any)
        .insert({ ...payload, id: record_id } as any);
      if (error) throw error;
      break;
    }
    case "UPDATE": {
      const { error } = await supabase
        .from(table_name as any)
        .update(payload as any)
        .eq("id", record_id);
      if (error) throw error;
      break;
    }
    case "DELETE": {
      const { error } = await supabase
        .from(table_name as any)
        .delete()
        .eq("id", record_id);
      if (error) throw error;
      break;
    }
  }
}

async function markSynced(tableName: string, recordId: string, operation: string) {
  if (operation === "DELETE") {
    // Remove from local DB
    const dexieTable = (localDb as any)[tableName];
    if (dexieTable) {
      await dexieTable.delete(recordId);
    }
  } else {
    // Mark as synced
    const dexieTable = (localDb as any)[tableName];
    if (dexieTable) {
      await dexieTable.update(recordId, {
        _sync_status: "synced",
        _synced_at: new Date().toISOString(),
      });
    }
  }
}

/**
 * Get count of pending sync entries.
 */
export async function getPendingSyncCount(): Promise<number> {
  return localDb.sync_queue.count();
}

/**
 * Initialize sync listeners. Call once at app startup.
 */
export function initSyncListeners() {
  // Sync when coming back online
  window.addEventListener("online", () => {
    console.log("[SyncService] Online detected, starting sync...");
    setTimeout(() => processSyncQueue(), 2000); // Small delay to let connection stabilize
  });

  // Periodic sync check (every 60s)
  setInterval(async () => {
    if (navigator.onLine) {
      const count = await getPendingSyncCount();
      if (count > 0) {
        processSyncQueue();
      }
    }
  }, 60_000);

  // Initial sync on startup
  if (navigator.onLine) {
    setTimeout(() => processSyncQueue(), 5000);
  }
}
