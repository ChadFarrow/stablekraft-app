/**
 * Whether a media element already holds `wanted` as its source.
 *
 * `HTMLMediaElement.src` reads back RESOLVED and SERIALIZED — always absolute,
 * spaces percent-encoded — while this app hands elements whatever URL it built,
 * and every proxied track is the relative `/api/proxy-audio?url=…`
 * (`proxiedAudioUrl`). So `el.src === wanted` is false for every proxied track,
 * which is most of the catalog (Wavlake's CloudFront host is proxied), and the
 * code that asked it did the expensive thing every time:
 *
 *   - the 15-second warm-up rebuilt its hidden element on every `timeupdate`,
 *     about 55 aborted `/api/proxy-audio` requests per song change;
 *   - the Android 5-second preload reloaded the idle element on every tick;
 *   - the ping-pong handoff never reused the element it had preloaded.
 *
 * Both sides are resolved against `base` (pass `document.baseURI`) and compared
 * as URLs. An empty source holds nothing: `new URL('', base)` is the base
 * itself, so without that check an idle element "holds" the page it sits on.
 */
export function holdsSource(
  current: string | null | undefined,
  wanted: string | null | undefined,
  base: string
): boolean {
  if (!current || !wanted) return false;
  if (current === wanted) return true;
  try {
    return new URL(current, base).href === new URL(wanted, base).href;
  } catch {
    return false;
  }
}
