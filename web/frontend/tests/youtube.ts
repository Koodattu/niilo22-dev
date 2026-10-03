import { expect, type Page } from "@playwright/test";

// The app, proxy and database remain real; only the external video host is replaced.
export async function installYouTubeDouble(page: Page, readyDelayMs = 0) {
  await page.route("https://www.youtube.com/embed/**", route => route.fulfill({
    contentType: "text/html", body: '<body style="background:#211915;color:#f4eee4;font:18px sans-serif;display:grid;place-items:center;height:90vh">Synteettinen testivideo</body>',
  }));
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.YT = { Player: class {
      constructor(frame, options) {
        this.frame = frame;
        this.options = options;
        this.time = Number(new URL(frame.src).searchParams.get('start') || 0);
        this.state = 5;
        this.listener = e => this.setState(e.detail);
        this.timeListener = e => {
          this.time = e.detail.time;
          if (e.detail.state !== undefined) this.setState(e.detail.state);
        };
        window.addEventListener('test-player-state', this.listener);
        window.addEventListener('test-player-time', this.timeListener);
        this.ready = setTimeout(() => {
          frame.dataset.testPlayerReady = 'true';
          options.events.onReady?.({ target: this });
        }, ${readyDelayMs});
      }
      setState(state) { this.state = state; this.options.events.onStateChange({ data: state }); }
      destroy() {
        clearTimeout(this.ready);
        window.removeEventListener('test-player-state', this.listener);
        window.removeEventListener('test-player-time', this.timeListener);
        this.frame.remove();
      }
      playVideo() { this.setState(1); }
      pauseVideo() { this.setState(2); }
      getCurrentTime() { return this.time; }
      getPlayerState() { return this.state; }
    }}; window.onYouTubeIframeAPIReady?.();`,
  }));
}

export async function setVideoTime(page: Page, time: number, state = 1) {
  await expect(page.locator(".stage-video")).toHaveAttribute("data-test-player-ready", "true");
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent("test-player-time", { detail })), { time, state });
}
