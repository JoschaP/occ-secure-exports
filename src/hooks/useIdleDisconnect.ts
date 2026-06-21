import { useEffect, useRef } from "react";

/** Default inactivity window before the connection is dropped (15 minutes). */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

interface Options {
  /** Only arm the timer while this is true (e.g. connected + in the explorer). */
  enabled: boolean;
  /** While true (e.g. a download is running), never fire — defer instead. */
  busy: boolean;
  /** Called once when the idle window elapses with no activity. */
  onIdle: () => void;
  timeoutMs?: number;
}

/**
 * Drop the session after a period of inactivity so a decrypted key doesn't sit
 * in memory unattended. Any user interaction (pointer, key, scroll, touch)
 * resets the timer; an active download keeps it alive (we re-arm instead of
 * firing) so a long transfer is never interrupted.
 */
export function useIdleDisconnect({
  enabled,
  busy,
  onIdle,
  timeoutMs = IDLE_TIMEOUT_MS,
}: Options) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // A download in flight must not be killed — wait another window.
        if (busyRef.current) arm();
        else onIdleRef.current();
      }, timeoutMs);
    };
    const events = [
      "mousedown",
      "keydown",
      "wheel",
      "touchstart",
      "pointermove",
    ];
    const onActivity = () => arm();
    events.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [enabled, timeoutMs]);
}
