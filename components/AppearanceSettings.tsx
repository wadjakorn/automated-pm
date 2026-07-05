"use client";

import { useTheme } from "./ThemeProvider";
import { ACCENT_PRESETS, THEME_CHOICES, THEME_PACKS } from "./theme";

export function AppearanceSettings() {
  const { choice, setChoice, pack, setPack, accent, setAccent } = useTheme();
  const activePack = THEME_PACKS.find((entry) => entry.key === pack) ?? THEME_PACKS[0];

  return (
    <div className="space-y-8 p-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-fg">Appearance</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          These settings apply to the whole app in this browser. They do not belong
          to the current project.
        </p>
      </section>

      <section className="theme-panel space-y-4 border border-border bg-bg-soft p-5">
        <div>
          <div className="mb-2 text-xs font-medium uppercase text-fg-subtle">
            Theme pack
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {THEME_PACKS.map((themePack) => {
              const active = themePack.key === pack;
              return (
                <button
                  key={themePack.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPack(themePack.key)}
                  className={`theme-card flex items-start justify-between border p-4 text-left ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-bg-card text-fg-muted hover:text-fg"
                  }`}
                >
                  <div>
                    <div className="font-medium text-fg">{themePack.label}</div>
                    <div className="mt-1 text-sm text-fg-muted">
                      {themePack.description}
                    </div>
                  </div>
                  {active && (
                    <span className="theme-pill border border-accent-border bg-bg-card px-2 py-0.5 text-xs text-accent">
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase text-fg-subtle">Mode</div>
          <div
            role="tablist"
            aria-label="Theme mode"
            className="inline-flex border border-border bg-bg-card p-1 theme-panel"
          >
            {THEME_CHOICES.map((mode) => {
              const active = choice === mode;
              return (
                <button
                  key={mode}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setChoice(mode)}
                  className={`min-w-20 px-3 py-1.5 text-sm capitalize ${
                    active
                      ? "bg-accent-soft text-accent ring-1 ring-accent-border"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </div>

        {activePack.supportsAccent && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase text-fg-subtle">
              Accent
            </div>
            <div className="flex flex-wrap gap-3">
              {ACCENT_PRESETS.map((preset) => {
                const active = accent === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    aria-label={`Accent: ${preset.label}`}
                    aria-pressed={active}
                    onClick={() => setAccent(preset.key)}
                    className={`theme-card flex h-10 min-w-24 items-center gap-2 border px-3 text-sm ${
                      active
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border bg-bg-card text-fg-muted hover:text-fg"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: preset.swatch }}
                    />
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="theme-panel border border-border bg-bg-soft p-5">
        <div className="mb-2 text-xs font-medium uppercase text-fg-subtle">
          Scope
        </div>
        <ul className="space-y-2 text-sm text-fg-muted">
          <li>Applies to all projects in this app.</li>
          <li>Stored locally in this browser.</li>
          <li>Separate from project settings like statuses, transitions, and repo URL.</li>
        </ul>
      </section>
    </div>
  );
}
