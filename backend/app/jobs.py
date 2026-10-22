"""A first-come, first-served queue for the slow work (download, chord analysis), with a visible place in line.

Each new song takes a while and the server does a few at a time, so when several people ask at once the rest wait.
Instead of a silent wait, a job knows how many are ahead of it and about how long that will take. Songs that are already
in the catalog never come through here; they open instantly.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Callable, Optional

log = logging.getLogger("thechordify.jobs")


class JobQueue:
    def __init__(self, workers: int = 1, max_waiting: int = 25, typical_seconds: float = 60.0) -> None:
        self._waiting: deque[tuple[str, Callable[[], None]]] = deque()
        self._running: set[str] = set()
        self._cond = threading.Condition()
        self._durations: deque[float] = deque(maxlen=20)
        self._typical = typical_seconds
        self.workers = max(1, workers)
        self.max_waiting = max_waiting
        for index in range(self.workers):
            threading.Thread(target=self._work, name=f"job-worker-{index}", daemon=True).start()

    def submit(self, key: str, task: Callable[[], None]) -> str:
        """Queues the task. Returns "queued", "already" (this key is already waiting or running) or "full"."""
        with self._cond:
            if key in self._running or any(k == key for k, _t in self._waiting):
                return "already"
            if len(self._waiting) >= self.max_waiting:
                return "full"
            self._waiting.append((key, task))
            self._cond.notify()
            return "queued"

    def ahead_of(self, key: str) -> Optional[int]:
        """How many jobs must finish before this one starts (None if it is not waiting)."""
        with self._cond:
            for index, (k, _t) in enumerate(self._waiting):
                if k == key:
                    return index + len(self._running)
            return None

    def wait_estimate(self, ahead: int) -> int:
        """About how many seconds until a job with `ahead` jobs in front of it is done: the rounds of work in front
        of it, plus its own run, at the recent typical time per song."""
        with self._cond:
            typical = sum(self._durations) / len(self._durations) if self._durations else self._typical
        rounds = ahead // self.workers + 1
        return int(round(rounds * typical))

    def stats(self) -> dict:
        with self._cond:
            return {"waiting": len(self._waiting), "running": len(self._running), "workers": self.workers}

    def _work(self) -> None:
        while True:
            with self._cond:
                while not self._waiting:
                    self._cond.wait()
                key, task = self._waiting.popleft()
                self._running.add(key)
            started = time.monotonic()
            try:
                task()
            except Exception:  # a job reports its own errors; this only keeps the worker alive
                log.exception("Job %s crashed", key)
            finally:
                with self._cond:
                    self._running.discard(key)
                    self._durations.append(time.monotonic() - started)
