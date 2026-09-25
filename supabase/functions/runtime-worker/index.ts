import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type QueueMessage = {
  message_id: number;
  event_id: string | null;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase function environment is incomplete.");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return new Response("Unauthorized", { status: 401 });
  }

  // The function is JWT-protected by the Supabase gateway. The caller must
  // provide a privileged service_role JWT. The token is forwarded to PostgREST
  // so the service_role-only RPCs are authorized by the database as well.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const { data: messages, error: dequeueError } = await supabase.rpc(
    "runtime_dequeue_events",
    {
      p_quantity: 10,
      p_visibility_seconds: 60,
    },
  );

  if (dequeueError) {
    console.error("Runtime worker dequeue failed", dequeueError);
    return Response.json(
      { processed: 0, failed: 0, error: "dequeue_failed" },
      { status: 503 },
    );
  }

  let processed = 0;
  let failed = 0;

  for (const message of (messages ?? []) as QueueMessage[]) {
    if (!message.event_id) {
      const { error } = await supabase.rpc("runtime_ack_event", {
        p_message_id: message.message_id,
      });

      if (error) {
        failed += 1;
        console.error("Runtime worker failed to acknowledge malformed message", error);
      } else {
        processed += 1;
      }

      continue;
    }

    const { error: processError } = await supabase.rpc(
      "runtime_process_event",
      { p_event_id: message.event_id },
    );

    if (processError) {
      failed += 1;
      console.error("Runtime worker event processing failed", {
        eventId: message.event_id,
        code: processError.code,
      });
      continue;
    }

    const { error: ackError } = await supabase.rpc("runtime_ack_event", {
      p_message_id: message.message_id,
    });

    if (ackError) {
      failed += 1;
      console.error("Runtime worker acknowledgement failed", {
        messageId: message.message_id,
        code: ackError.code,
      });
      continue;
    }

    processed += 1;
  }

  return Response.json({
    processed,
    failed,
    queue_batch_size: (messages ?? []).length,
  });
});
