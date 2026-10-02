/**
 * Looping background track for a level. Browsers only allow audio after a user
 * gesture, so `play()` is called from the Start button / first input.
 */
export class Music {
  constructor(src, { volume = 0.45 } = {}) {
    this.volume = volume;
    this.audio = new Audio(src);
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.volume = volume;
    this.fadeTimer = null;
  }

  play() {
    clearInterval(this.fadeTimer);
    this.audio.volume = this.volume;
    this.audio.play().catch(() => {
      // Autoplay blocked: retry on the next user gesture.
      addEventListener('pointerdown', () => this.play(), { once: true });
      addEventListener('keydown', () => this.play(), { once: true });
    });
  }

  pause() {
    this.audio.pause();
  }

  fadeOut(seconds = 1.5) {
    clearInterval(this.fadeTimer);
    const step = this.audio.volume / (seconds * 20);
    this.fadeTimer = setInterval(() => {
      this.audio.volume = Math.max(0, this.audio.volume - step);
      if (this.audio.volume <= 0) {
        clearInterval(this.fadeTimer);
        this.audio.pause();
      }
    }, 50);
  }
}
