// Going to a song and coming back. Picking a song puts its card in a waiting state ("Opening…", a spinner, the other cards disabled)
// and goes on to the song. Pressing Back then brings the page back from the browser's memory exactly as it was left, waiting state
// and all. So a page that is left for a song is loaded afresh when it comes back, which also brings what changed meanwhile
// (the play counts and history, the favourites).
let leaving = false;

window.addEventListener("pageshow", (event) => {
  if (event.persisted && leaving) {
    leaving = false;
    window.location.reload();
  }
});

/** Goes to the waiting screen of a song that is being started. */
export function goToProcessing(sessionId: string) {
  leaving = true;
  window.location.href = `/processing?session=${sessionId}`;
}
