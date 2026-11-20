/**
 * Minimalist auto-hiding HUD controller for audio balance, twilight mood,
 * quality selection, fullscreen, and zen visibility toggle.
 */
export class ControlsController {
  constructor(initialState, handlers) {
    this.state = { ...initialState };
    this.handlers = handlers;
    this.drawerOpen = false;
    this.zenHidden = false;
    this.idleTimer = null;

    this.els = {
      soundPrompt: document.getElementById('sound-prompt'),
      hud: document.getElementById('hud'),
      btnSound: document.getElementById('btn-sound'),
      btnSoundLabel: document.getElementById('btn-sound-label'),
      btnStoke: document.getElementById('btn-stoke'),
      btnSettings: document.getElementById('btn-settings'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      drawer: document.getElementById('settings-drawer'),
      resolutionReadout: document.getElementById('resolution-readout'),
      sliderFire: document.getElementById('slider-fire'),
      sliderCrackle: document.getElementById('slider-crackle'),
      sliderOcean: document.getElementById('slider-ocean'),
      valFire: document.getElementById('val-fire'),
      valCrackle: document.getElementById('val-crackle'),
      valOcean: document.getElementById('val-ocean'),
      moodButtons: Array.from(document.querySelectorAll('[data-mood]')),
      qualityButtons: Array.from(document.querySelectorAll('[data-quality]')),
    };

    this._bindEvents();
    this._syncVolumeUI();
    this.notifyActivity();
  }

  _bindEvents() {
    this.els.soundPrompt?.addEventListener('click', () => {
      this.handlers.onEnableSound?.();
    });

    this.els.btnSound?.addEventListener('click', () => {
      this.notifyActivity();
      this.handlers.onToggleSound?.();
    });

    this.els.btnStoke?.addEventListener('click', () => {
      this.notifyActivity();
      this.handlers.onStoke?.();
    });

    this.els.btnSettings?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.notifyActivity();
      this.setDrawerOpen(!this.drawerOpen);
    });

    this.els.btnFullscreen?.addEventListener('click', () => {
      this.notifyActivity();
      this.toggleFullscreen();
    });

    const bindSlider = (input, valueEl, channel) => {
      input?.addEventListener('input', () => {
        this.notifyActivity();
        const val = parseFloat(input.value);
        if (valueEl) valueEl.textContent = `${Math.round(val * 100)}%`;
        this.handlers.onVolumeChange?.(channel, val);
      });
    };

    bindSlider(this.els.sliderFire, this.els.valFire, 'fire');
    bindSlider(this.els.sliderCrackle, this.els.valCrackle, 'crackle');
    bindSlider(this.els.sliderOcean, this.els.valOcean, 'ocean');

    for (const btn of this.els.moodButtons) {
      btn.addEventListener('click', () => {
        this.notifyActivity();
        const mood = btn.dataset.mood;
        this.setActiveMood(mood);
        this.handlers.onMoodChange?.(mood);
      });
    }

    for (const btn of this.els.qualityButtons) {
      btn.addEventListener('click', () => {
        this.notifyActivity();
        const quality = btn.dataset.quality;
        this.setActiveQuality(quality);
        this.handlers.onQualityChange?.(quality);
      });
    }

    // Dismiss settings drawer when clicking outside HUD or pressing Escape
    document.addEventListener('click', (event) => {
      if (this.drawerOpen && this.els.hud && !this.els.hud.contains(event.target)) {
        this.setDrawerOpen(false);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.drawerOpen) {
        this.setDrawerOpen(false);
      }
    });
  }

  _syncVolumeUI() {
    const v = this.state.volumes;
    if (this.els.sliderFire) this.els.sliderFire.value = String(v.fire);
    if (this.els.sliderCrackle) this.els.sliderCrackle.value = String(v.crackle);
    if (this.els.sliderOcean) this.els.sliderOcean.value = String(v.ocean);
    if (this.els.valFire) this.els.valFire.textContent = `${Math.round(v.fire * 100)}%`;
    if (this.els.valCrackle) this.els.valCrackle.textContent = `${Math.round(v.crackle * 100)}%`;
    if (this.els.valOcean) this.els.valOcean.textContent = `${Math.round(v.ocean * 100)}%`;
  }

  setSoundState({ unlocked, muted }) {
    document.body.classList.toggle('sound-locked', !unlocked);
    if (this.els.btnSound) {
      this.els.btnSound.classList.toggle('is-muted', muted);
    }
    if (this.els.btnSoundLabel) {
      this.els.btnSoundLabel.textContent = muted ? '音をつける' : '再生中';
    }
    if (unlocked) {
      this.notifyActivity();
    }
  }

  setActiveMood(moodId) {
    for (const btn of this.els.moodButtons) {
      const active = btn.dataset.mood === moodId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  setActiveQuality(qualityId) {
    for (const btn of this.els.qualityButtons) {
      const active = btn.dataset.quality === qualityId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  setResolutionReadout(label, width, height) {
    if (this.els.resolutionReadout) {
      this.els.resolutionReadout.textContent = `${label} · ${width}×${height}`;
    }
  }

  setDrawerOpen(open) {
    this.drawerOpen = Boolean(open);
    if (this.els.drawer) {
      this.els.drawer.hidden = !this.drawerOpen;
    }
    if (this.els.btnSettings) {
      this.els.btnSettings.classList.toggle('is-active', this.drawerOpen);
      this.els.btnSettings.setAttribute('aria-expanded', String(this.drawerOpen));
    }
    if (this.drawerOpen) {
      document.body.classList.remove('ui-idle');
      if (this.idleTimer) window.clearTimeout(this.idleTimer);
    } else {
      this.notifyActivity();
    }
  }

  toggleZen() {
    this.zenHidden = !this.zenHidden;
    document.body.classList.toggle('ui-hidden', this.zenHidden);
    if (this.zenHidden) {
      this.setDrawerOpen(false);
    } else {
      this.notifyActivity();
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  notifyActivity() {
    if (this.zenHidden) return;
    document.body.classList.remove('ui-idle');
    if (this.idleTimer) window.clearTimeout(this.idleTimer);

    if (this.drawerOpen) return;

    this.idleTimer = window.setTimeout(() => {
      if (!this.drawerOpen && !document.body.classList.contains('sound-locked')) {
        document.body.classList.add('ui-idle');
      }
    }, this.state.idleHideMs);
  }
}
