"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const TERMINAL = new Set([
  "completed",
  "partially_failed",
  "canceled",
]);

const POLL_MS = 2000;

interface Props {
  status: string;
}

/**
 * Polls the server (via router.refresh) every 2s while the batch is
 * in-flight. Stops once the status is terminal. Renders nothing.
 */
export function BatchProgressPoller({ status }: Props) {
  const router = useRouter();
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (TERMINAL.has(status)) {
      stoppedRef.current = true;
      return;
    }
    const id = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [status, router]);

  return null;
}
